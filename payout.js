/*
 * Payout logic: turns the spreadsheet rows into warehouse -> shop totals.
 * No browser APIs here, so it can also be tested with Node.
 */
(function (root) {
  'use strict';

  var RATE_CASE = 100;      // Rs. per case
  var RATE_BOTTLE = 4.167;  // Rs. per bottle

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var COLUMNS = {
    warehouse: 'warehouse name',
    licensee: 'licensee name',
    item: 'item name',
    indentDate: 'indent approve date',
    cases: 'issue cases',
    bottles: 'issue bottles'
  };

  function norm(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  // Find the header row and map each needed column to its index.
  function findHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var row = rows[r] || [];
      var map = {};
      row.forEach(function (cell, i) {
        var key = norm(cell).toLowerCase();
        Object.keys(COLUMNS).forEach(function (k) {
          if (key === COLUMNS[k] && map[k] === undefined) map[k] = i;
        });
      });
      var missing = Object.keys(COLUMNS).filter(function (k) { return map[k] === undefined; });
      if (missing.length === 0) return { row: r, map: map };
      if (Object.keys(map).length >= 3) {
        throw new Error('Missing column(s): ' + missing.map(function (k) { return '"' + titleCase(COLUMNS[k]) + '"'; }).join(', '));
      }
    }
    throw new Error('Could not find the header row. Expected columns such as "Warehouse Name", "Licensee Name", "Issue Cases".');
  }

  function titleCase(s) {
    return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Quantities may arrive as numbers or as text ("14", " 1,200 ", "").
  function parseQty(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).replace(/[,\s]/g, '');
    if (s === '' || s === '-') return 0;
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // "WH-KOLLAM FL9-KLM-01/2026-27" -> "WH-KOLLAM"
  function warehouseShort(v) {
    var s = norm(v);
    return s ? s.split(' ')[0] : '';
  }

  // Shops start with a 4 or 5 digit code, e.g. "2001-HQ KOLLAM", "10002-KUTTIPPALA".
  var SHOP_RE = /^(\d{4,5})(?!\d)/;

  // Returns {year, month (0-11)} or null. Accepts dd-mm-yyyy text, Date objects, Excel serials.
  function parseMonth(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return { year: v.getFullYear(), month: v.getMonth() };
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    }
    var s = norm(v);
    var m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) {
      var mo = Number(m[2]) - 1;
      if (mo >= 0 && mo < 12) return { year: Number(m[3]), month: mo };
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) - 1 };
    if (/^\d+(\.\d+)?$/.test(s)) return parseMonth(Number(s));
    return null;
  }

  // Commission in paise (integer) to avoid floating point drift, rounded to 2 dp.
  function commissionPaise(cases, bottles) {
    return Math.round(cases * RATE_CASE * 100 + bottles * RATE_BOTTLE * 100);
  }

  function process(rows) {
    var header = findHeader(rows);
    var c = header.map;
    var warehouses = {};
    var excludedNames = {};
    var excludedRows = 0;
    var badRows = [];
    var items = {};
    var months = {};
    var badDates = 0;
    var keptRows = 0;

    for (var r = header.row + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var licensee = norm(row[c.licensee]);
      var wh = warehouseShort(row[c.warehouse]);

      // Completely blank rows and the trailing "Total" row are ignored silently.
      if (!licensee && !wh) continue;

      var code = licensee.match(SHOP_RE);
      if (!code) {
        excludedRows++;
        excludedNames[licensee || '(blank licensee name)'] = true;
        continue;
      }

      var cases = parseQty(row[c.cases]);
      var bottles = parseQty(row[c.bottles]);
      if (isNaN(cases) || isNaN(bottles)) {
        badRows.push({ excelRow: r + 1, shop: licensee, cases: row[c.cases], bottles: row[c.bottles] });
        continue;
      }
      if (!wh) wh = '(no warehouse)';

      keptRows++;
      var item = norm(row[c.item]);
      if (item) items[item] = true;
      var mon = parseMonth(row[c.indentDate]);
      if (mon) months[mon.year * 12 + mon.month] = true; else badDates++;

      var w = warehouses[wh] || (warehouses[wh] = { name: wh, shops: {} });
      var shop = w.shops[licensee] || (w.shops[licensee] = {
        name: licensee, code: Number(code[1]), cases: 0, bottles: 0, orders: 0
      });
      shop.cases += cases;
      shop.bottles += bottles;
      shop.orders++;
    }

    if (keptRows === 0) throw new Error('No shop rows found. Shop names must start with a 4 or 5 digit code, e.g. "2001-HQ KOLLAM".');

    var grand = { cases: 0, bottles: 0, paise: 0, shops: 0 };
    var list = Object.keys(warehouses).sort().map(function (k) {
      var w = warehouses[k];
      var shops = Object.keys(w.shops).map(function (s) { return w.shops[s]; })
        .sort(function (a, b) { return a.code - b.code || a.name.localeCompare(b.name); });
      var tot = { cases: 0, bottles: 0, paise: 0 };
      shops.forEach(function (s) {
        s.paise = commissionPaise(s.cases, s.bottles);
        tot.cases += s.cases; tot.bottles += s.bottles; tot.paise += s.paise;
      });
      grand.cases += tot.cases; grand.bottles += tot.bottles; grand.paise += tot.paise;
      grand.shops += shops.length;
      return { name: w.name, shops: shops, total: tot };
    });

    var monthKeys = Object.keys(months).map(Number).sort(function (a, b) { return a - b; });
    var itemNames = Object.keys(items).sort();
    var warnings = [];

    var monthLabel;
    if (monthKeys.length === 0) {
      monthLabel = '(unknown month)';
      warnings.push('Could not read any Indent Approve Date, so the month is unknown.');
    } else {
      monthLabel = monthName(monthKeys[0]);
      if (monthKeys.length > 1) {
        monthLabel = monthName(monthKeys[0]) + ' – ' + monthName(monthKeys[monthKeys.length - 1]);
        warnings.push('Indent Approve Dates span more than one month: ' + monthKeys.map(monthName).join(', ') + '.');
      }
    }
    if (badDates) warnings.push(badDates + ' shop row(s) have an unreadable Indent Approve Date (still included in totals).');

    var itemLabel = itemNames.length ? itemNames.join(' / ') : '(unknown item)';
    if (itemNames.length > 1) warnings.push('The file contains more than one Item Name: ' + itemNames.join(', ') + '. Totals combine all of them.');
    if (!itemNames.length) warnings.push('No Item Name found in the file.');

    badRows.forEach(function (b) {
      warnings.push('Row ' + b.excelRow + ' (' + b.shop + ') skipped: quantity is not a number (cases "' + b.cases + '", bottles "' + b.bottles + '").');
    });

    return {
      title: monthLabel + ' Shop Purchase Analysis for ' + itemLabel,
      item: itemLabel,
      month: monthLabel,
      warehouses: list,
      grand: grand,
      warnings: warnings,
      excludedRows: excludedRows,
      excludedNames: Object.keys(excludedNames).sort(function (a, b) { return a.localeCompare(b); }),
      keptRows: keptRows
    };
  }

  function monthName(key) {
    return MONTHS[key % 12] + ' ' + Math.floor(key / 12);
  }

  var moneyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

  function money(paise) { return moneyFmt.format(paise / 100); }

  function qty(cases, bottles) {
    return intFmt.format(cases) + (cases === 1 ? ' case' : ' cases') + ' + ' +
      intFmt.format(bottles) + (bottles === 1 ? ' bottle' : ' bottles');
  }

  function num(n) { return intFmt.format(n); }

  var api = {
    process: process, money: money, qty: qty, num: num, parseQty: parseQty, parseMonth: parseMonth,
    warehouseShort: warehouseShort, commissionPaise: commissionPaise,
    RATE_CASE: RATE_CASE, RATE_BOTTLE: RATE_BOTTLE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Payout = api;
})(this);
