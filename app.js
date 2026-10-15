(function () {
  'use strict';
  const Core = window.CostCore;
  const KEYS = { settings: 'importCost.germanyEdition.settings.v1', records: 'importCost.germanyEdition.records.v1' };
  const PAGE_META = {
    calculator: ['SPECIAL AIR FREIGHT', '特貨空運成本試算'],
    result: ['AIR FREIGHT RESULT', '特貨空運結果與說明'],
    'sea-calculator': ['CONSOLIDATED SEA FREIGHT', '海運集貨成本試算'],
    'sea-result': ['SEA FREIGHT RESULT', '海運集貨結果與說明'],
    history: ['COST HISTORY', '歷史成本紀錄'],
    settings: ['FREIGHT SETTINGS', '廠商與運費設定']
  };
  const SEA_COUNTRY_IDS = ['jp', 'kr', 'de'];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function load(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return value || fallback; }
    catch (_) { return fallback; }
  }

  let settings = load(KEYS.settings, Core.clone(Core.DEFAULT_SETTINGS));
  if (!Array.isArray(settings.seaFreightRates)) settings.seaFreightRates = Core.clone(Core.DEFAULT_SETTINGS.seaFreightRates);
  settings.version = 3;
  let records = load(KEYS.records, []);
  records.forEach(record => {
    if (recordType(record) !== 'air' || !record.calculation || Object.prototype.hasOwnProperty.call(record.input, 'expectedCost')) return;
    const calculation = record.calculation;
    calculation.pricingCostTwd = null;
    calculation.wholesalePrice = null;
    record.input.expectedCost = null;
    record.summary = Core.buildCostSummary(record.input, calculation);
  });
  let latestAir = null;
  let latestSea = null;
  let editingAirRecordId = null;
  let editingSeaRecordId = null;
  let pendingExpectedCost = null;
  let pendingDeleteId = null;

  const air = {
    form: $('#calculator-form'), country: $('#country'), currency: $('#currency'), vendor: $('#vendor'),
    productName: $('#product-name'), unitPrice: $('#unit-price'), exchangeRate: $('#exchange-rate'), krwToUsd: $('#air-krw-to-usd'), usdToTwd: $('#air-usd-to-twd'), weightG: $('#weight-g'), marginRate: $('#margin-rate'),
    german: $('#germany-discount'), auDiscount: $('#australia-discount'), auSurcharge: $('#australia-surcharge'),
    actualFreight: $('#actual-freight'), notes: $('#notes'), error: $('#form-error'), save: $('#save-record')
  };
  const sea = {
    form: $('#sea-calculator-form'), country: $('#sea-country'), currency: $('#sea-currency'), vendor: $('#sea-vendor'),
    productName: $('#sea-product-name'), unitPrice: $('#sea-unit-price'), exchangeRate: $('#sea-exchange-rate'), krwToUsd: $('#sea-krw-to-usd'), usdToTwd: $('#sea-usd-to-twd'),
    tariffRate: $('#sea-tariff-rate'), zhangDiscount: $('#sea-zhang-discount'), notes: $('#sea-notes'),
    error: $('#sea-form-error'), save: $('#sea-save-record')
  };

  function persist() {
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
    localStorage.setItem(KEYS.records, JSON.stringify(records));
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function money(value, currency) {
    const code = currency || 'TWD';
    if (code === 'TWD') return `NT$${new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  function number(value, digits) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits == null ? 6 : digits }).format(value); }
  function dateTime(value) { return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => node.classList.remove('show'), 2600);
  }
  function showError(messages, target) {
    const list = Array.isArray(messages) ? messages : [messages];
    target.innerHTML = list.map(item => `<div>${escapeHtml(item)}</div>`).join(''); target.classList.remove('hidden');
  }
  function clearError(target) { target.classList.add('hidden'); target.textContent = ''; }
  function recordType(record) { return record.transportType === 'sea' ? 'sea' : 'air'; }
  function navigate(page) {
    $$('.page').forEach(node => node.classList.toggle('active', node.id === `page-${page}`));
    $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === page));
    $('#page-eyebrow').textContent = PAGE_META[page][0]; $('#page-title').textContent = PAGE_META[page][1];
    if (page === 'history') renderHistory();
    if (page === 'settings') renderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 特貨空運
  function renderAirCountryOptions(selected) {
    const active = settings.countries.filter(item => item.active);
    air.country.innerHTML = '<option value="">請選擇國家</option>' + active.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    if (selected) air.country.value = selected;
  }
  function onAirCountryChange(keepVendor) {
    const country = settings.countries.find(item => item.id === air.country.value);
    air.currency.value = country ? country.currency : ''; $('#price-unit').textContent = country ? country.currency : '原幣';
    const isKorea = country && country.id === 'kr';
    const isThailand = country && country.id === 'th';
    $('#air-standard-exchange-field').classList.toggle('hidden', !!isKorea || !!isThailand);
    $('#air-krw-to-usd-field').classList.toggle('hidden', !isKorea);
    $('#air-usd-to-twd-field').classList.toggle('hidden', !isKorea);
    $('#air-thailand-exchange-field').classList.toggle('hidden', !isThailand);
    air.exchangeRate.required = !isKorea && !isThailand; air.krwToUsd.required = !!isKorea; air.usdToTwd.required = !!isKorea;
    if (isKorea) air.exchangeRate.value = '';
    else if (isThailand) { air.exchangeRate.value = ''; air.krwToUsd.value = ''; air.usdToTwd.value = ''; }
    else { air.krwToUsd.value = ''; air.usdToTwd.value = ''; }
    const vendors = settings.vendors.filter(item => item.active && country && item.countryId === country.id);
    air.vendor.disabled = !country;
    air.vendor.innerHTML = country ? '<option value="">請選擇廠商</option>' + vendors.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('') : '<option value="">請先選擇國家</option>';
    if (keepVendor && vendors.some(item => item.id === keepVendor)) air.vendor.value = keepVendor;
    const isGermany = country && country.id === 'de'; const isAustralia = country && country.id === 'au';
    $('#option-germany').classList.toggle('hidden', !isGermany); $('#option-australia-discount').classList.toggle('hidden', !isAustralia); $('#option-australia-surcharge').classList.toggle('hidden', !isAustralia);
    if (!isGermany) air.german.checked = false;
    if (!isAustralia) { air.auDiscount.checked = false; air.auSurcharge.checked = false; }
    updateAirVendorRule();
  }
  function updateAirVendorRule() {
    const vendor = settings.vendors.find(item => item.id === air.vendor.value); const country = settings.countries.find(item => item.id === air.country.value); const manual = vendor && vendor.mode === 'manual';
    $('#option-manual-freight').classList.toggle('hidden', !manual); $('#conditional-options').classList.toggle('hidden', !(country && (country.id === 'de' || country.id === 'au')) && !manual);
    air.actualFreight.required = !!manual; if (!manual) air.actualFreight.value = '';
    const hint = $('#vendor-rate-hint');
    if (!vendor) hint.textContent = '';
    else if (vendor.mode === 'unset') hint.innerHTML = '<span class="warning-text">尚未設定運費，請先到設定補填費率。</span>';
    else if (vendor.mode === 'manual') hint.textContent = '本廠商採本次實際台幣運費。';
    else hint.textContent = `運費：${vendor.rateCurrency === 'LOCAL' ? country.currency : 'NT$'} ${number(vendor.rate, 4)}／kg`;
    invalidateAir();
  }
  function readAirForm() {
    return { productName: air.productName.value.trim(), countryId: air.country.value, vendorId: air.vendor.value, unitPrice: air.unitPrice.value, exchangeRate: air.exchangeRate.value, krwToUsd: air.krwToUsd.value, usdToTwd: air.usdToTwd.value, weightG: air.weightG.value, marginRate: air.marginRate.value, germanyDiscount: air.german.checked, australiaDiscount: air.auDiscount.checked, australiaSurcharge: air.auSurcharge.checked, actualFreight: air.actualFreight.value, notes: air.notes.value.trim() };
  }
  function invalidateAir() { latestAir = null; air.save.disabled = true; $('#result-save').disabled = true; }
  function calculateAir(event) {
    if (event) event.preventDefault(); clearError(air.error); const input = readAirForm();
    try {
      const calculation = Core.calculateCost(input, settings);
      const normalized = { ...input, unitPrice: Number(input.unitPrice), exchangeRate: input.exchangeRate === '' ? null : Number(input.exchangeRate), krwToUsd: input.krwToUsd === '' ? null : Number(input.krwToUsd), usdToTwd: input.usdToTwd === '' ? null : Number(input.usdToTwd), weightG: Number(input.weightG), marginRate: Number(input.marginRate), expectedCost: pendingExpectedCost == null || pendingExpectedCost === '' ? null : Number(pendingExpectedCost), actualFreight: input.actualFreight === '' ? null : Number(input.actualFreight) };
      latestAir = { transportType: 'air', input: normalized, calculation, summary: '' };
      pendingExpectedCost = null;
      renderAirResult(latestAir); updateExpectedCost(); navigate('result');
    } catch (error) { showError(error.validationErrors || error.message, air.error); }
  }
  function airFreightRuleText(calc) {
    if (calc.vendor.mode === 'manual') return '本次實際運費';
    return `${calc.vendor.rateCurrency === 'LOCAL' ? calc.currency : 'NT$'} ${number(calc.vendor.rate, 4)}／kg`;
  }
  function renderSteps(target, steps) {
    target.innerHTML = steps.map((step, index) => `<div class="calculation-step ${step.total ? 'total' : ''}"><span class="step-number">${index + 1}</span><div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.formula)}</p></div><em>${escapeHtml(step.result)}</em></div>`).join('');
  }
  function renderAirResult(data) {
    if (!data) { $('#result-empty').classList.remove('hidden'); $('#result-content').classList.add('hidden'); return; }
    const { input, calculation: c } = data; $('#result-empty').classList.add('hidden'); $('#result-content').classList.remove('hidden');
    $('#expected-cost').disabled = false;
    $('#result-product').textContent = input.productName; $('#result-context').textContent = `${c.country.name} · ${c.vendor.name} · ${number(c.weightG, 2)} g`; $('#result-total').textContent = money(c.totalTwd);
    $('#result-foreign').textContent = money(c.adjustedForeign, c.currency); $('#result-adjustment').textContent = c.adjustments.length ? c.adjustments.map(item => item.label).join('、') : '未套用折扣或加價';
    $('#result-product-twd').textContent = money(c.productTwd); $('#result-rate').textContent = c.krwToUsd && c.usdToTwd ? `1 KRW＝${number(c.krwToUsd, 12)} USD；1 USD＝${number(c.usdToTwd, 6)} TWD` : `匯率 ${number(c.exchangeRate, 6)}`; $('#result-freight').textContent = money(c.freightTwd); $('#result-freight-rule').textContent = airFreightRuleText(c);
    $('#result-margin-rate').textContent = `${number(c.marginRate, 2)}%`;
    $('#expected-cost').value = input.expectedCost == null ? '' : input.expectedCost;
    $('#result-wholesale-price').textContent = c.wholesalePrice == null ? '請輸入預想成本' : money(c.wholesalePrice);
    const priceParts = [`${number(c.unitPrice, 4)} ${c.currency}`]; c.adjustments.forEach(item => priceParts.push(`× ${item.multiplier}`));
    let freightFormula = '採用本次輸入的實際台幣運費';
    if (c.vendor.mode !== 'manual' && c.vendor.rateCurrency === 'LOCAL') freightFormula = `${number(c.weightKg, 4)} kg × ${number(c.vendor.rate, 4)} ${c.currency}／kg × 匯率 ${number(c.exchangeRate, 6)}`;
    else if (c.vendor.mode !== 'manual') freightFormula = `${number(c.weightKg, 4)} kg × NT$ ${number(c.vendor.rate, 4)}／kg`;
    const steps = [
      { title: '重量換算', formula: `${number(c.weightG, 2)} g ÷ 1,000`, result: `${number(c.weightKg, 4)} kg` },
      { title: '調整後商品原幣金額', formula: priceParts.join(' '), result: money(c.adjustedForeign, c.currency) }
    ];
    if (c.krwToUsd && c.usdToTwd) {
      steps.push({ title: '韓元換算美元', formula: `${number(c.adjustedForeign, 6)} KRW × ${number(c.krwToUsd, 12)} USD／KRW`, result: money(c.intermediateUsd, 'USD') });
      steps.push({ title: '美元換算台幣', formula: `${number(c.intermediateUsd, 9)} USD × ${number(c.usdToTwd, 6)} TWD／USD`, result: money(c.productTwd) });
    } else steps.push({ title: '商品台幣成本', formula: `${number(c.adjustedForeign, 6)} ${c.currency} × 匯率 ${number(c.exchangeRate, 6)}`, result: money(c.productTwd) });
    steps.push({ title: '特貨空運費', formula: freightFormula, result: money(c.freightTwd) });
    steps.push({ title: '含運單件成本', formula: `${money(c.productTwd)} ＋ ${money(c.freightTwd)}`, result: money(c.totalTwd), total: true });
    steps.push({ title: '建議批價', formula: c.pricingCostTwd == null ? '請於上方輸入預想成本後計算' : `${money(c.pricingCostTwd)} ÷（1－${number(c.marginRate, 2)}%）`, result: c.wholesalePrice == null ? '尚未計算' : money(c.wholesalePrice), total: true });
    renderSteps($('#calculation-steps'), steps);
    const note = $('#result-notes'); note.classList.toggle('hidden', !input.notes); note.innerHTML = input.notes ? `<strong>備註</strong><p>${escapeHtml(input.notes).replace(/\n/g, '<br>')}</p>` : '';
    $('#copy-summary-text').value = Core.buildCostSummary(input, c);
  }
  function updateExpectedCost() {
    if (!latestAir) return;
    const raw = $('#expected-cost').value.trim(); const value = Number(raw); const valid = raw !== '' && Number.isFinite(value) && value > 0;
    latestAir.input.expectedCost = valid ? value : null;
    latestAir.calculation.pricingCostTwd = valid ? value : null;
    latestAir.calculation.wholesalePrice = valid ? Core.round(value / (1 - latestAir.calculation.marginRate / 100), 2) : null;
    latestAir.summary = Core.buildCostSummary(latestAir.input, latestAir.calculation);
    $('#result-wholesale-price').textContent = valid ? money(latestAir.calculation.wholesalePrice) : '請輸入預想成本';
    $('#copy-summary-text').value = latestAir.summary;
    const pricingStep = $('#calculation-steps').lastElementChild;
    if (pricingStep) {
      pricingStep.querySelector('p').textContent = valid ? `${money(value)} ÷（1－${number(latestAir.calculation.marginRate, 2)}%）` : '請於上方輸入預想成本後計算';
      pricingStep.querySelector('em').textContent = valid ? money(latestAir.calculation.wholesalePrice) : '尚未計算';
    }
    air.save.disabled = !valid || (!!latestAir.id && !editingAirRecordId);
    $('#result-save').disabled = !valid || (!!latestAir.id && !editingAirRecordId);
  }

  // 海運集貨
  function activeSeaRates(countryId) { return settings.seaFreightRates.filter(rate => rate.active && (!countryId || rate.countryId === countryId)); }
  function renderSeaCountryOptions(selected) {
    const eligible = SEA_COUNTRY_IDS.map(id => settings.countries.find(country => country.id === id && country.active)).filter(country => country && activeSeaRates(country.id).length);
    sea.country.innerHTML = '<option value="">請選擇國家</option>' + eligible.map(country => `<option value="${country.id}">${escapeHtml(country.name)}</option>`).join('');
    if (selected) sea.country.value = selected;
  }
  function onSeaCountryChange(keepVendor) {
    const country = settings.countries.find(item => item.id === sea.country.value); sea.currency.value = country ? country.currency : ''; $('#sea-price-unit').textContent = country ? country.currency : '原幣';
    const isKorea = country && country.id === 'kr';
    $('#sea-standard-exchange-field').classList.toggle('hidden', !!isKorea);
    $('#sea-krw-to-usd-field').classList.toggle('hidden', !isKorea);
    $('#sea-usd-to-twd-field').classList.toggle('hidden', !isKorea);
    sea.exchangeRate.required = !isKorea; sea.krwToUsd.required = !!isKorea; sea.usdToTwd.required = !!isKorea;
    if (isKorea) sea.exchangeRate.value = ''; else { sea.krwToUsd.value = ''; sea.usdToTwd.value = ''; }
    const vendorIds = activeSeaRates(country && country.id).map(rate => rate.vendorId);
    const vendors = settings.vendors.filter(vendor => vendor.active && country && vendor.countryId === country.id && vendorIds.includes(vendor.id));
    sea.vendor.disabled = !country; sea.vendor.innerHTML = country ? '<option value="">請選擇廠商</option>' + vendors.map(vendor => `<option value="${vendor.id}">${escapeHtml(vendor.name)}</option>`).join('') : '<option value="">請先選擇國家</option>';
    if (keepVendor && vendors.some(vendor => vendor.id === keepVendor)) sea.vendor.value = keepVendor;
    updateSeaVendorRule();
  }
  function updateSeaVendorRule() {
    const vendor = settings.vendors.find(item => item.id === sea.vendor.value); const rate = activeSeaRates(sea.country.value).find(item => item.vendorId === sea.vendor.value); const canDiscount = vendor && vendor.id === 'de-zhang';
    $('#sea-conditional-options').classList.toggle('hidden', !canDiscount); if (!canDiscount) sea.zhangDiscount.checked = false;
    $('#sea-rate-hint').textContent = rate ? `平均每件運費：NT$${number(rate.perItemRate, 2)}／件` : ''; invalidateSea();
  }
  function readSeaForm() { return { productName: sea.productName.value.trim(), countryId: sea.country.value, vendorId: sea.vendor.value, unitPrice: sea.unitPrice.value, exchangeRate: sea.exchangeRate.value, krwToUsd: sea.krwToUsd.value, usdToTwd: sea.usdToTwd.value, tariffRate: sea.tariffRate.value, zhangDiscount: sea.zhangDiscount.checked, notes: sea.notes.value.trim() }; }
  function invalidateSea() { latestSea = null; sea.save.disabled = true; $('#sea-result-save').disabled = true; }
  function calculateSea(event) {
    if (event) event.preventDefault(); clearError(sea.error); const input = readSeaForm();
    try {
      const calculation = Core.calculateSeaCost(input, settings); const normalized = { ...input, unitPrice: Number(input.unitPrice), exchangeRate: input.exchangeRate === '' ? null : Number(input.exchangeRate), krwToUsd: input.krwToUsd === '' ? null : Number(input.krwToUsd), usdToTwd: input.usdToTwd === '' ? null : Number(input.usdToTwd), tariffRate: Number(input.tariffRate) };
      latestSea = { transportType: 'sea', input: normalized, calculation, summary: Core.buildSeaCostSummary(normalized, calculation) };
      sea.save.disabled = false; $('#sea-result-save').disabled = false; renderSeaResult(latestSea); navigate('sea-result');
    } catch (error) { showError(error.validationErrors || error.message, sea.error); }
  }
  function renderSeaResult(data) {
    if (!data) { $('#sea-result-empty').classList.remove('hidden'); $('#sea-result-content').classList.add('hidden'); return; }
    const { input, calculation: c } = data; $('#sea-result-empty').classList.add('hidden'); $('#sea-result-content').classList.remove('hidden');
    $('#sea-result-product').textContent = input.productName; $('#sea-result-context').textContent = `${c.country.name} · ${c.vendor.name} · 關稅 ${number(c.tariffRate)}%`; $('#sea-result-total').textContent = money(c.totalTwd);
    $('#sea-result-original').textContent = money(c.unitPrice, c.currency); $('#sea-result-discount-status').textContent = c.discountApplied ? '已套用張總 9 折' : '未套用折扣';
    $('#sea-result-adjusted').textContent = money(c.adjustedForeign, c.currency); $('#sea-result-rate').textContent = c.krwToUsd && c.usdToTwd ? `1 KRW＝${number(c.krwToUsd, 12)} USD；1 USD＝${number(c.usdToTwd, 6)} TWD` : `匯率 ${number(c.exchangeRate, 6)}`; $('#sea-result-product-twd').textContent = money(c.productTwd);
    $('#sea-result-freight').textContent = money(c.perItemFreight); $('#sea-result-dutiable').textContent = money(c.dutiablePrice); $('#sea-result-tariff-label').textContent = `關稅（${number(c.tariffRate)}%）`; $('#sea-result-tariff').textContent = money(c.tariffAmount); $('#sea-result-business-tax').textContent = money(c.businessTaxAmount);
    const adjustedFormula = c.discountApplied ? `${number(c.unitPrice, 6)} ${c.currency} × 0.9` : '未套用折扣，維持原幣單價';
    const steps = [{ title: '折扣後原幣單價', formula: adjustedFormula, result: money(c.adjustedForeign, c.currency) }];
    if (c.krwToUsd && c.usdToTwd) {
      steps.push({ title: '韓元換算美元', formula: `${number(c.adjustedForeign, 6)} KRW × ${number(c.krwToUsd, 12)} USD／KRW`, result: money(c.intermediateUsd, 'USD') });
      steps.push({ title: '美元換算台幣', formula: `${number(c.intermediateUsd, 9)} USD × ${number(c.usdToTwd, 6)} TWD／USD`, result: money(c.productTwd) });
    } else steps.push({ title: '商品台幣成本', formula: `${number(c.adjustedForeign, 6)} ${c.currency} × 匯率 ${number(c.exchangeRate, 6)}`, result: money(c.productTwd) });
    steps.push({ title: '完稅價格', formula: `${money(c.productTwd)} ＋ 平均運費 ${money(c.perItemFreight)}`, result: money(c.dutiablePrice) });
    steps.push({ title: `關稅（${number(c.tariffRate)}%）`, formula: `${money(c.dutiablePrice)} × ${number(c.tariffRate)}%`, result: money(c.tariffAmount) });
    steps.push({ title: '營業稅（固定 5%）', formula: `（${money(c.dutiablePrice)} ＋ ${money(c.tariffAmount)}）× 5%`, result: money(c.businessTaxAmount) });
    steps.push({ title: '海運單件總成本', formula: `${money(c.dutiablePrice)} ＋ ${money(c.tariffAmount)} ＋ ${money(c.businessTaxAmount)}`, result: money(c.totalTwd), total: true });
    renderSteps($('#sea-calculation-steps'), steps);
    const note = $('#sea-result-notes'); note.classList.toggle('hidden', !input.notes); note.innerHTML = input.notes ? `<strong>備註</strong><p>${escapeHtml(input.notes).replace(/\n/g, '<br>')}</p>` : '';
    $('#sea-copy-summary-text').value = data.summary || Core.buildSeaCostSummary(input, c);
  }

  async function copyField(field, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(field.value);
      else { field.focus(); field.select(); if (!document.execCommand('copy')) throw new Error('copy failed'); field.setSelectionRange(0, 0); }
      toast(successMessage);
    } catch (_) { field.focus(); field.select(); toast('已選取文字，請按 Ctrl+C 複製'); }
  }
  function saveRecord(type) {
    const data = type === 'sea' ? latestSea : latestAir; const editingId = type === 'sea' ? editingSeaRecordId : editingAirRecordId; if (!data) return;
    if (type === 'air' && (data.calculation.pricingCostTwd == null || data.calculation.wholesalePrice == null)) { toast('請先輸入預想成本，完成建議批價計算'); return; }
    records = Core.upsertRecord(records, data, editingId, new Date().toISOString());
    if (type === 'sea') { editingSeaRecordId = null; updateSeaEditIndicator(); sea.save.disabled = true; $('#sea-result-save').disabled = true; }
    else { editingAirRecordId = null; updateAirEditIndicator(); air.save.disabled = true; $('#result-save').disabled = true; $('#expected-cost').disabled = true; }
    persist(); toast(editingId ? '歷史紀錄已更新' : '成本紀錄已儲存');
  }
  function resetAirCalculator() { air.form.reset(); editingAirRecordId = null; pendingExpectedCost = null; latestAir = null; clearError(air.error); renderAirCountryOptions(); onAirCountryChange(); updateAirEditIndicator(); renderAirResult(null); }
  function resetSeaCalculator() { sea.form.reset(); editingSeaRecordId = null; latestSea = null; clearError(sea.error); renderSeaCountryOptions(); onSeaCountryChange(); updateSeaEditIndicator(); renderSeaResult(null); }
  function updateAirEditIndicator() { const node = $('#edit-indicator'); node.classList.toggle('hidden', !editingAirRecordId); node.textContent = editingAirRecordId ? '目前正在修改既有特貨空運紀錄；儲存後會更新原紀錄。' : ''; }
  function updateSeaEditIndicator() { const node = $('#sea-edit-indicator'); node.classList.toggle('hidden', !editingSeaRecordId); node.textContent = editingSeaRecordId ? '目前正在修改既有海運集貨紀錄；儲存後會更新原紀錄。' : ''; }
  function editRecord(id) {
    const record = records.find(item => item.id === id); if (!record) return; const input = record.input;
    if (recordType(record) === 'sea') {
      renderSeaCountryOptions(input.countryId); onSeaCountryChange(input.vendorId); sea.productName.value = input.productName; sea.unitPrice.value = input.unitPrice; sea.exchangeRate.value = input.exchangeRate == null ? '' : input.exchangeRate; sea.krwToUsd.value = input.krwToUsd == null ? '' : input.krwToUsd; sea.usdToTwd.value = input.usdToTwd == null ? '' : input.usdToTwd; sea.tariffRate.value = input.tariffRate; sea.zhangDiscount.checked = !!input.zhangDiscount; sea.notes.value = input.notes || '';
      editingSeaRecordId = id; latestSea = null; updateSeaEditIndicator(); updateSeaVendorRule(); navigate('sea-calculator');
    } else {
      renderAirCountryOptions(input.countryId); onAirCountryChange(input.vendorId); air.productName.value = input.productName; air.unitPrice.value = input.unitPrice; air.exchangeRate.value = input.exchangeRate == null ? '' : input.exchangeRate; air.krwToUsd.value = input.krwToUsd == null ? '' : input.krwToUsd; air.usdToTwd.value = input.usdToTwd == null ? '' : input.usdToTwd; air.weightG.value = input.weightG; air.marginRate.value = input.marginRate == null ? '' : input.marginRate; air.german.checked = !!input.germanyDiscount; air.auDiscount.checked = !!input.australiaDiscount; air.auSurcharge.checked = !!input.australiaSurcharge; air.actualFreight.value = input.actualFreight == null ? '' : input.actualFreight; air.notes.value = input.notes || '';
      pendingExpectedCost = input.expectedCost == null ? null : input.expectedCost;
      editingAirRecordId = id; latestAir = null; updateAirEditIndicator(); updateAirVendorRule(); navigate('calculator');
    }
    toast('已載入紀錄，修改後請重新計算');
  }
  function viewRecord(id) {
    const record = records.find(item => item.id === id); if (!record) return;
    if (recordType(record) === 'sea') { latestSea = Core.clone(record); renderSeaResult(latestSea); $('#sea-result-save').disabled = true; navigate('sea-result'); }
    else { latestAir = Core.clone(record); renderAirResult(latestAir); $('#expected-cost').disabled = true; $('#result-save').disabled = true; air.save.disabled = true; navigate('result'); }
  }
  function requestDelete(id) { pendingDeleteId = id; $('#confirm-dialog').showModal(); }
  function deleteRecord(id) {
    records = Core.deleteRecord(records, id); persist(); renderHistory(); toast('紀錄已刪除');
    if (editingAirRecordId === id) resetAirCalculator(); if (editingSeaRecordId === id) resetSeaCalculator();
  }
  function renderHistory() {
    const query = $('#history-search').value.trim().toLowerCase();
    const filtered = records.filter(record => { const label = recordType(record) === 'sea' ? '海運集貨' : '特貨空運'; return [label, record.input.productName, record.calculation.country.name, record.calculation.vendor.name, record.input.notes].some(value => String(value || '').toLowerCase().includes(query)); });
    $('#history-count').textContent = query ? `${filtered.length} / ${records.length} 筆` : `共 ${records.length} 筆`; $('#history-empty').classList.toggle('hidden', records.length > 0 || !!query);
    const list = $('#history-list'); if (!filtered.length && query) { list.innerHTML = '<div class="no-search-result">找不到符合條件的紀錄。</div>'; return; }
    list.innerHTML = filtered.map(record => {
      const c = record.calculation; const isSea = recordType(record) === 'sea'; const typeLabel = isSea ? '海運集貨' : '特貨空運';
      const context = isSea ? `${c.country.name} · ${c.vendor.name} · 關稅 ${number(c.tariffRate)}%` : `${c.country.name} · ${c.vendor.name} · ${number(c.weightG, 2)} g`;
      const costLabel = isSea ? '海運單件總成本' : '含運單件成本';
      const detail = isSea ? `商品 ${money(c.productTwd)} ＋ 運費 ${money(c.perItemFreight)} ＋ 稅費 ${money(c.tariffAmount + c.businessTaxAmount)}` : `商品 ${money(c.productTwd)} ＋ 運費 ${money(c.freightTwd)} · ${c.pricingCostTwd == null ? '尚未輸入預想成本' : `預想成本 ${money(c.pricingCostTwd)} · 毛利 ${number(c.marginRate, 2)}% · 批價 ${money(c.wholesalePrice)}`}`;
      return `<article class="history-card"><div class="history-main"><div class="history-date"><span class="transport-badge ${isSea ? 'sea' : 'air'}">${typeLabel}</span>${escapeHtml(dateTime(record.updatedAt || record.createdAt))}</div><h3>${escapeHtml(record.input.productName)}</h3><p>${escapeHtml(context)}</p>${record.input.notes ? `<small>${escapeHtml(record.input.notes)}</small>` : ''}</div><div class="history-cost"><span>${costLabel}</span><strong>${escapeHtml(money(c.totalTwd))}</strong><small>${escapeHtml(detail)}</small></div><div class="history-actions"><button data-action="view" data-id="${record.id}" class="button ghost compact">查看</button><button data-action="edit" data-id="${record.id}" class="button secondary compact">修改</button><button data-action="delete" data-id="${record.id}" class="icon-button delete" aria-label="刪除 ${escapeHtml(record.input.productName)}">×</button></div></article>`;
    }).join('');
  }

  function renderSettings() {
    $('#country-settings-list').innerHTML = settings.countries.filter(country => country.id === 'de').map(country => `<div class="setting-row ${country.active ? '' : 'inactive'}"><div><strong>${escapeHtml(country.name)}</strong><small>${escapeHtml(country.currency)} · 德國專用版本</small></div></div>`).join('');
    $('#vendor-settings-list').innerHTML = settings.vendors.map(vendor => {
      const country = settings.countries.find(item => item.id === vendor.countryId); let rule = '尚未設定運費'; if (vendor.mode === 'manual') rule = '每次輸入實際台幣運費'; if (vendor.mode === 'rate') rule = `${vendor.rateCurrency === 'LOCAL' ? (country ? country.currency : '當地幣') : 'NT$'} ${number(vendor.rate, 4)}／kg`;
      return `<div class="setting-row ${vendor.active ? '' : 'inactive'}"><div><strong>${escapeHtml(vendor.name)}</strong><small>${escapeHtml(country ? country.name : '未知國家')} · ${escapeHtml(rule)}${vendor.active ? '' : ' · 已停用'}</small></div><button class="button ghost compact" data-setting="vendor" data-id="${vendor.id}">編輯</button></div>`;
    }).join('');
    $('#sea-rate-settings-list').innerHTML = settings.seaFreightRates.map(rate => {
      const country = settings.countries.find(item => item.id === rate.countryId); const vendor = settings.vendors.find(item => item.id === rate.vendorId);
      return `<div class="setting-row ${rate.active ? '' : 'inactive'}"><div><strong>${escapeHtml(vendor ? vendor.name : '未知廠商')}</strong><small>${escapeHtml(country ? country.name : '未知國家')} · NT$${number(rate.perItemRate, 2)}／件${rate.active ? '' : ' · 已停用'}</small></div><button class="button ghost compact" data-setting="sea-rate" data-id="${rate.id}">編輯</button></div>`;
    }).join('');
  }
  function openCountryDialog(id) {
    const country = settings.countries.find(item => item.id === id); $('#country-dialog-title').textContent = country ? '編輯國家' : '新增國家'; $('#country-edit-id').value = country ? country.id : ''; $('#setting-country-name').value = country ? country.name : ''; $('#setting-country-currency').value = country ? country.currency : ''; $('#setting-country-active').checked = country ? country.active : true; $('#country-form-error').classList.add('hidden'); $('#country-dialog').showModal();
  }
  function saveCountry(event) {
    event.preventDefault(); const id = $('#country-edit-id').value; const name = $('#setting-country-name').value.trim(); const currency = $('#setting-country-currency').value.trim().toUpperCase(); const error = $('#country-form-error');
    if (!name || !/^[A-Z]{3,6}$/.test(currency)) { error.textContent = '請輸入國家名稱，以及 3–6 位英文字母幣別代碼。'; error.classList.remove('hidden'); return; }
    if (settings.countries.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) { error.textContent = '這個國家名稱已存在。'; error.classList.remove('hidden'); return; }
    const values = { name, currency, active: $('#setting-country-active').checked }; if (id) Object.assign(settings.countries.find(item => item.id === id), values); else settings.countries.push({ id: Core.makeId('country'), ...values });
    persist(); $('#country-dialog').close(); renderAirCountryOptions(); onAirCountryChange(); renderSeaCountryOptions(); onSeaCountryChange(); renderSettings(); toast('國家設定已儲存');
  }
  function renderVendorCountryOptions(selected) { $('#setting-vendor-country').innerHTML = settings.countries.map(item => `<option value="${item.id}">${escapeHtml(item.name)}${item.active ? '' : '（已停用）'}</option>`).join(''); if (selected) $('#setting-vendor-country').value = selected; }
  function openVendorDialog(id) {
    const vendor = settings.vendors.find(item => item.id === id); $('#vendor-dialog-title').textContent = vendor ? '編輯廠商與運費' : '新增廠商'; $('#vendor-edit-id').value = vendor ? vendor.id : ''; renderVendorCountryOptions(vendor && vendor.countryId); $('#setting-vendor-name').value = vendor ? vendor.name : ''; $('#setting-freight-mode').value = vendor ? vendor.mode : 'rate'; $('#setting-rate').value = vendor && vendor.rate != null ? vendor.rate : ''; $('#setting-rate-currency').value = vendor ? vendor.rateCurrency : 'TWD'; $('#setting-vendor-active').checked = vendor ? vendor.active : true; $('#vendor-form-error').classList.add('hidden'); toggleRateFields(); $('#vendor-dialog').showModal();
  }
  function toggleRateFields() { $('#rate-fields').classList.toggle('hidden', $('#setting-freight-mode').value !== 'rate'); }
  function saveVendor(event) {
    event.preventDefault(); const id = $('#vendor-edit-id').value; const countryId = $('#setting-vendor-country').value; const name = $('#setting-vendor-name').value.trim(); const mode = $('#setting-freight-mode').value; const rate = Number($('#setting-rate').value); const error = $('#vendor-form-error');
    if (!countryId || !name) { error.textContent = '請選擇國家並輸入廠商名稱。'; error.classList.remove('hidden'); return; }
    if (settings.vendors.some(item => item.id !== id && item.countryId === countryId && item.name.toLowerCase() === name.toLowerCase())) { error.textContent = '這個國家已有同名廠商。'; error.classList.remove('hidden'); return; }
    if (mode === 'rate' && (!Number.isFinite(rate) || rate <= 0)) { error.textContent = '每公斤費率必須大於 0。'; error.classList.remove('hidden'); return; }
    const values = { countryId, name, mode, rate: mode === 'rate' ? rate : null, rateCurrency: $('#setting-rate-currency').value, active: $('#setting-vendor-active').checked }; if (id) Object.assign(settings.vendors.find(item => item.id === id), values); else settings.vendors.push({ id: Core.makeId('vendor'), ...values });
    persist(); $('#vendor-dialog').close(); renderSettings(); renderAirCountryOptions(); onAirCountryChange(); renderSeaCountryOptions(); onSeaCountryChange(); toast('廠商與運費設定已儲存');
  }
  function openSeaRateDialog(id) {
    const rate = settings.seaFreightRates.find(item => item.id === id); if (!rate) return; const country = settings.countries.find(item => item.id === rate.countryId); const vendor = settings.vendors.find(item => item.id === rate.vendorId);
    $('#sea-rate-edit-id').value = id; $('#sea-rate-vendor-label').textContent = vendor ? vendor.name : '未知廠商'; $('#sea-rate-country-label').textContent = country ? `${country.name} · ${country.currency}` : ''; $('#setting-sea-rate').value = rate.perItemRate; $('#setting-sea-rate-active').checked = rate.active; $('#sea-rate-form-error').classList.add('hidden'); $('#sea-rate-dialog').showModal();
  }
  function saveSeaRate(event) {
    event.preventDefault(); const id = $('#sea-rate-edit-id').value; const value = Number($('#setting-sea-rate').value); const error = $('#sea-rate-form-error');
    if (!Number.isFinite(value) || value < 0) { error.textContent = '平均每件運費不可小於 0。'; error.classList.remove('hidden'); return; }
    const rate = settings.seaFreightRates.find(item => item.id === id); if (!rate) return; rate.perItemRate = value; rate.active = $('#setting-sea-rate-active').checked;
    persist(); $('#sea-rate-dialog').close(); renderSettings(); renderSeaCountryOptions(); onSeaCountryChange(); toast('海運平均每件運費已儲存');
  }

  function bindEvents() {
    $$('.nav-item').forEach(node => node.addEventListener('click', () => navigate(node.dataset.page))); $$('[data-go]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.go)));
    air.country.addEventListener('change', () => onAirCountryChange()); air.vendor.addEventListener('change', updateAirVendorRule); air.form.addEventListener('submit', calculateAir); $('#reset-calculator').addEventListener('click', resetAirCalculator);
    air.save.addEventListener('click', () => saveRecord('air')); $('#result-save').addEventListener('click', () => saveRecord('air')); $('#expected-cost').addEventListener('input', updateExpectedCost); $('#copy-summary').addEventListener('click', () => copyField($('#copy-summary-text'), '成本說明已複製')); $$('#calculator-form input, #calculator-form textarea').forEach(node => node.addEventListener('input', invalidateAir));
    sea.country.addEventListener('change', () => onSeaCountryChange()); sea.vendor.addEventListener('change', updateSeaVendorRule); sea.form.addEventListener('submit', calculateSea); $('#reset-sea-calculator').addEventListener('click', resetSeaCalculator);
    sea.save.addEventListener('click', () => saveRecord('sea')); $('#sea-result-save').addEventListener('click', () => saveRecord('sea')); $('#copy-sea-summary').addEventListener('click', () => copyField($('#sea-copy-summary-text'), '海運成本說明已複製')); $$('#sea-calculator-form input, #sea-calculator-form textarea').forEach(node => node.addEventListener('input', invalidateSea));
    $('#history-search').addEventListener('input', renderHistory); $('#history-list').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button) return; ({ view: viewRecord, edit: editRecord, delete: requestDelete })[button.dataset.action](button.dataset.id); });
    $('#confirm-dialog').addEventListener('close', () => { if ($('#confirm-dialog').returnValue === 'confirm' && pendingDeleteId) deleteRecord(pendingDeleteId); pendingDeleteId = null; });
    $('#add-country').addEventListener('click', () => openCountryDialog()); $('#add-vendor').addEventListener('click', () => openVendorDialog());
    $('#country-settings-list').addEventListener('click', event => { const button = event.target.closest('[data-setting="country"]'); if (button) openCountryDialog(button.dataset.id); }); $('#vendor-settings-list').addEventListener('click', event => { const button = event.target.closest('[data-setting="vendor"]'); if (button) openVendorDialog(button.dataset.id); }); $('#sea-rate-settings-list').addEventListener('click', event => { const button = event.target.closest('[data-setting="sea-rate"]'); if (button) openSeaRateDialog(button.dataset.id); });
    $('#country-form').addEventListener('submit', saveCountry); $('#vendor-form').addEventListener('submit', saveVendor); $('#sea-rate-form').addEventListener('submit', saveSeaRate); $('#setting-freight-mode').addEventListener('change', toggleRateFields);
    $$('[data-close]').forEach(node => node.addEventListener('click', () => document.getElementById(node.dataset.close).close()));
  }
  function init() {
    persist(); $('#today').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
    renderAirCountryOptions(); onAirCountryChange(); renderAirResult(null); renderSeaCountryOptions(); onSeaCountryChange(); renderSeaResult(null); renderHistory(); renderSettings(); bindEvents();
  }
  init();
})();
