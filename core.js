(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CostCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    version: 3,
    countries: [
      { id: 'de', name: '德國', currency: 'EUR', active: true }
    ],
    vendors: [
      { id: 'de-lianglu', countryId: 'de', name: '良嵂', mode: 'rate', rate: 180, rateCurrency: 'TWD', active: true }
    ],
    seaFreightRates: []
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function toNumber(value) { return typeof value === 'number' ? value : Number(value); }
  function isPositive(value) { return Number.isFinite(toNumber(value)) && toNumber(value) > 0; }
  function isNonNegative(value) { return Number.isFinite(toNumber(value)) && toNumber(value) >= 0; }
  function round(value, digits) {
    const factor = Math.pow(10, digits == null ? 6 : digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function validateCalculation(input, settings) {
    const errors = [];
    const country = settings.countries.find(item => item.id === input.countryId && item.active);
    const vendor = settings.vendors.find(item => item.id === input.vendorId && item.active);
    if (!String(input.productName || '').trim()) errors.push('請輸入商品名稱。');
    if (!country) errors.push('請選擇有效的國家。');
    if (!vendor || (country && vendor.countryId !== country.id)) errors.push('請選擇該國家的有效廠商。');
    if (!isPositive(input.unitPrice)) errors.push('商品原幣單價必須大於 0。');
    if (country && country.id === 'kr') {
      if (!isPositive(input.krwToUsd)) errors.push('韓元兌美元匯率必須大於 0（請輸入 1 韓元等於多少美元）。');
      if (!isPositive(input.usdToTwd)) errors.push('美元兌台幣匯率必須大於 0。');
    } else if ((!country || country.id !== 'th') && !isPositive(input.exchangeRate)) errors.push('匯率必須大於 0。');
    if (!isPositive(input.weightG)) errors.push('商品重量必須大於 0。');
    if (String(input.marginRate == null ? '' : input.marginRate).trim() === '' || !Number.isFinite(toNumber(input.marginRate)) || toNumber(input.marginRate) < 0 || toNumber(input.marginRate) >= 100) errors.push('毛利率請輸入 0 至 100 之間的百分比（不含 100）。');
    if (vendor && vendor.mode === 'unset') errors.push(`廠商「${vendor.name}」尚未設定運費，請先至「廠商與運費設定」補填費率。`);
    if (vendor && vendor.mode === 'rate' && !isPositive(vendor.rate)) errors.push(`廠商「${vendor.name}」的每公斤費率無效，請先至設定修正。`);
    if (vendor && vendor.mode === 'manual' && !isNonNegative(input.actualFreight)) errors.push('請輸入本次實際台幣運費（可輸入 0）。');
    return { errors, country, vendor };
  }

  function calculateCost(input, settings) {
    const checked = validateCalculation(input, settings);
    if (checked.errors.length) {
      const error = new Error(checked.errors.join('\n'));
      error.validationErrors = checked.errors;
      throw error;
    }
    const country = checked.country;
    const vendor = checked.vendor;
    const unitPrice = toNumber(input.unitPrice);
    const isKorea = country.id === 'kr';
    const isThailand = country.id === 'th';
    const krwToUsd = isKorea ? toNumber(input.krwToUsd) : null;
    const usdToTwd = isKorea ? toNumber(input.usdToTwd) : null;
    const exchangeRate = isKorea ? krwToUsd * usdToTwd : isThailand ? 1 : toNumber(input.exchangeRate);
    const weightG = toNumber(input.weightG);
    const weightKg = weightG / 1000;
    let adjustedForeign = unitPrice;
    const adjustments = [];

    if (country.id === 'de' && input.germanyDiscount) {
      adjustedForeign *= 0.9;
      adjustments.push({ label: '德國打 9 折', multiplier: 0.9 });
    }
    if (country.id === 'au' && input.australiaDiscount) {
      adjustedForeign *= 0.91;
      adjustments.push({ label: '澳洲打 9.1 折', multiplier: 0.91 });
    }
    if (country.id === 'au' && input.australiaSurcharge) {
      adjustedForeign *= 1.04;
      adjustments.push({ label: '澳洲外加 4%', multiplier: 1.04 });
    }

    const intermediateUsd = isKorea ? adjustedForeign * krwToUsd : null;
    const productTwd = isKorea ? intermediateUsd * usdToTwd : adjustedForeign * exchangeRate;
    let freightTwd;
    let freightLocal = null;
    if (vendor.mode === 'manual') {
      freightTwd = toNumber(input.actualFreight);
    } else if (vendor.rateCurrency === 'LOCAL') {
      freightLocal = weightKg * toNumber(vendor.rate);
      freightTwd = freightLocal * exchangeRate;
    } else {
      freightTwd = weightKg * toNumber(vendor.rate);
    }

    const totalTwd = round(productTwd + freightTwd);
    const marginRate = toNumber(input.marginRate);
    return {
      country: clone(country),
      vendor: clone(vendor),
      currency: country.currency,
      unitPrice: round(unitPrice),
      adjustedForeign: round(adjustedForeign),
      exchangeRate: round(exchangeRate),
      krwToUsd: krwToUsd == null ? null : round(krwToUsd, 12),
      usdToTwd: usdToTwd == null ? null : round(usdToTwd),
      intermediateUsd: intermediateUsd == null ? null : round(intermediateUsd),
      weightG: round(weightG),
      weightKg: round(weightKg),
      adjustments,
      productTwd: round(productTwd),
      freightLocal: freightLocal == null ? null : round(freightLocal),
      freightTwd: round(freightTwd),
      totalTwd,
      pricingCostTwd: null,
      marginRate: round(marginRate, 2),
      wholesalePrice: null
    };
  }

  function validateSeaCalculation(input, settings) {
    const errors = [];
    const country = settings.countries.find(item => item.id === input.countryId && item.active);
    const vendor = settings.vendors.find(item => item.id === input.vendorId && item.active);
    const seaRate = (settings.seaFreightRates || []).find(item => item.countryId === input.countryId && item.vendorId === input.vendorId && item.active);
    if (!String(input.productName || '').trim()) errors.push('請輸入商品名稱。');
    if (!country || !['jp', 'kr', 'de'].includes(country.id)) errors.push('請選擇海運集貨適用的國家。');
    if (!vendor || (country && vendor.countryId !== country.id) || !seaRate) errors.push('請選擇該國家的海運集貨廠商。');
    if (!isPositive(input.unitPrice)) errors.push('商品原幣單價必須大於 0。');
    if (country && country.id === 'kr') {
      if (!isPositive(input.krwToUsd)) errors.push('韓元兌美元匯率必須大於 0（請輸入 1 韓元等於多少美元）。');
      if (!isPositive(input.usdToTwd)) errors.push('美元兌台幣匯率必須大於 0。');
    } else if (!isPositive(input.exchangeRate)) errors.push('匯率必須大於 0。');
    if (input.tariffRate === '' || input.tariffRate == null || !isNonNegative(input.tariffRate)) errors.push('請輸入有效的關稅稅率（例如 4 代表 4%）。');
    if (seaRate && !isNonNegative(seaRate.perItemRate)) errors.push(`廠商「${vendor ? vendor.name : ''}」的海運平均每件運費無效，請先至設定修正。`);
    return { errors, country, vendor, seaRate };
  }

  function calculateSeaCost(input, settings) {
    const checked = validateSeaCalculation(input, settings);
    if (checked.errors.length) {
      const error = new Error(checked.errors.join('\n'));
      error.validationErrors = checked.errors;
      throw error;
    }
    const unitPrice = toNumber(input.unitPrice);
    const isKorea = checked.country.id === 'kr';
    const krwToUsd = isKorea ? toNumber(input.krwToUsd) : null;
    const usdToTwd = isKorea ? toNumber(input.usdToTwd) : null;
    const exchangeRate = isKorea ? krwToUsd * usdToTwd : toNumber(input.exchangeRate);
    const tariffRate = toNumber(input.tariffRate);
    const discountApplied = checked.vendor.id === 'de-zhang' && !!input.zhangDiscount;
    const adjustedForeign = discountApplied ? unitPrice * 0.9 : unitPrice;
    const intermediateUsd = isKorea ? adjustedForeign * krwToUsd : null;
    const productTwd = isKorea ? intermediateUsd * usdToTwd : adjustedForeign * exchangeRate;
    const perItemFreight = toNumber(checked.seaRate.perItemRate);
    const dutiablePrice = productTwd + perItemFreight;
    const tariffAmount = dutiablePrice * tariffRate / 100;
    const businessTaxRate = 5;
    const businessTaxAmount = (dutiablePrice + tariffAmount) * businessTaxRate / 100;
    const totalTwd = dutiablePrice + tariffAmount + businessTaxAmount;
    return {
      country: clone(checked.country),
      vendor: clone(checked.vendor),
      seaRate: clone(checked.seaRate),
      currency: checked.country.currency,
      unitPrice: round(unitPrice),
      discountApplied,
      adjustedForeign: round(adjustedForeign),
      exchangeRate: round(exchangeRate),
      krwToUsd: krwToUsd == null ? null : round(krwToUsd, 12),
      usdToTwd: usdToTwd == null ? null : round(usdToTwd),
      intermediateUsd: intermediateUsd == null ? null : round(intermediateUsd),
      productTwd: round(productTwd),
      perItemFreight: round(perItemFreight),
      dutiablePrice: round(dutiablePrice),
      tariffRate: round(tariffRate),
      tariffAmount: round(tariffAmount),
      businessTaxRate,
      businessTaxAmount: round(businessTaxAmount),
      totalTwd: round(totalTwd)
    };
  }

  function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 9);
    return `${prefix || 'id'}-${Date.now().toString(36)}-${random}`;
  }

  function upsertRecord(records, data, recordId, now) {
    const list = clone(Array.isArray(records) ? records : []);
    const timestamp = now || new Date().toISOString();
    if (recordId) {
      const index = list.findIndex(item => item.id === recordId);
      if (index < 0) throw new Error('找不到要更新的成本紀錄。');
      list[index] = { ...list[index], ...clone(data), updatedAt: timestamp };
      return list;
    }
    list.unshift({ id: makeId('record'), ...clone(data), createdAt: timestamp, updatedAt: timestamp });
    return list;
  }

  function deleteRecord(records, recordId) {
    return clone(Array.isArray(records) ? records : []).filter(item => item.id !== recordId);
  }

  function formatSummaryNumber(value, minimumFractionDigits, maximumFractionDigits) {
    return new Intl.NumberFormat('zh-TW', {
      minimumFractionDigits: minimumFractionDigits == null ? 0 : minimumFractionDigits,
      maximumFractionDigits: maximumFractionDigits == null ? 6 : maximumFractionDigits
    }).format(value);
  }

  function buildCostSummary(input, calculation) {
    const adjustment = calculation.adjustments && calculation.adjustments.length
      ? `（${calculation.adjustments.map(item => item.label).join('、')}）`
      : '';
    let freightCondition;
    if (calculation.vendor.mode === 'manual') {
      freightCondition = `實際運費 NT$${formatSummaryNumber(calculation.freightTwd, 2, 2)}`;
    } else if (calculation.vendor.rateCurrency === 'LOCAL') {
      freightCondition = `運費 ${calculation.currency} ${formatSummaryNumber(calculation.vendor.rate)}/kg（換算 NT$${formatSummaryNumber(calculation.freightTwd, 2, 2)}）`;
    } else {
      freightCondition = `運費 NT$${formatSummaryNumber(calculation.vendor.rate)}/kg`;
    }
    const lines = [String(input.productName || '').trim()];
    if (String(input.notes || '').trim()) lines.push(String(input.notes).trim());
    const exchangeDescription = calculation.currency === 'KRW' && calculation.krwToUsd && calculation.usdToTwd
      ? `1 KRW＝${formatSummaryNumber(calculation.krwToUsd, 0, 12)} USD、1 USD＝${formatSummaryNumber(calculation.usdToTwd)} TWD`
      : `匯率 ${formatSummaryNumber(calculation.exchangeRate)}`;
    const hasGermanyDiscount = calculation.adjustments && calculation.adjustments.some(item => item.label === '德國打 9 折');
    const unitPriceDescription = hasGermanyDiscount
      ? `${calculation.currency} 單價 ${formatSummaryNumber(calculation.unitPrice)} 9折為 ${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(calculation.adjustedForeign)} €`
      : `${calculation.currency} 單價 ${formatSummaryNumber(calculation.unitPrice)}${adjustment}`;
    lines.push(`${calculation.vendor.name}｜${unitPriceDescription}｜${exchangeDescription}｜重量 ${formatSummaryNumber(calculation.weightG)}g｜${freightCondition}。`);
    lines.push(`含運單件成本為 NT$${formatSummaryNumber(calculation.totalTwd, 2, 2)}。`);
    if (calculation.pricingCostTwd != null && calculation.wholesalePrice != null) {
      lines.push(`以預想成本 NT$${formatSummaryNumber(calculation.pricingCostTwd, 2, 2)}、毛利率 ${formatSummaryNumber(calculation.marginRate)}% 計算，建議批價 NT$${formatSummaryNumber(calculation.wholesalePrice, 2, 2)}（預想成本 ÷（1－毛利率））。`);
    } else {
      lines.push(`毛利率 ${formatSummaryNumber(calculation.marginRate)}%；請輸入預想成本後計算建議批價。`);
    }
    return lines.join('\n');
  }

  function currencyPrefix(currency) {
    return currency === 'EUR' ? '€' : `${currency} `;
  }

  function buildSeaCostSummary(input, calculation) {
    const lines = [String(input.productName || '').trim()];
    if (String(input.notes || '').trim()) lines.push(String(input.notes).trim());
    const freight = formatSummaryNumber(calculation.perItemFreight);
    const tariff = formatSummaryNumber(calculation.tariffRate);
    const rate = formatSummaryNumber(calculation.exchangeRate);
    if (calculation.discountApplied) {
      const symbol = currencyPrefix(calculation.currency);
      lines.push(`${calculation.vendor.name}原價 ${symbol}${formatSummaryNumber(calculation.unitPrice, 2, 2)}，打 9 折後 ${symbol}${formatSummaryNumber(calculation.adjustedForeign, 2, 2)}；以匯率 ${rate}、平均運費 NT$${freight}／件、關稅 ${tariff}% 計算。`);
    } else {
      const exchangeDescription = calculation.currency === 'KRW' && calculation.krwToUsd && calculation.usdToTwd
        ? `1 KRW＝${formatSummaryNumber(calculation.krwToUsd, 0, 12)} USD、1 USD＝${formatSummaryNumber(calculation.usdToTwd)} TWD`
        : `匯率 ${rate}`;
      lines.push(`${calculation.vendor.name} ${calculation.currency} ${formatSummaryNumber(calculation.unitPrice)}，以${exchangeDescription}、平均運費 NT$${freight}／件、關稅 ${tariff}% 計算。`);
    }
    lines.push(`海運單件總成本為 NT$${formatSummaryNumber(calculation.totalTwd, 2, 2)}。`);
    return lines.join('\n');
  }

  return { DEFAULT_SETTINGS, clone, round, validateCalculation, calculateCost, validateSeaCalculation, calculateSeaCost, makeId, upsertRecord, deleteRecord, buildCostSummary, buildSeaCostSummary };
});
