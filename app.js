(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('file');
  var drop = $('drop');
  var statusEl = $('status');
  var resultEl = $('result');
  var previewEl = $('preview');
  var frame = $('preview-frame');
  var btnPreview = $('btn-preview');

  var current = null; // { report, blob, url, filename }

  function setStatus(msg, isError) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isError ? ' error' : '');
  }

  // read-excel-file returns either rows or [{ sheet, data }] depending on version.
  function firstSheetRows(result) {
    if (Array.isArray(result) && result.length && result[0] && !Array.isArray(result[0]) && result[0].data) {
      return result[0].data;
    }
    return result;
  }

  function handleFile(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setStatus('Please choose an .xlsx file (older .xls files are not supported — re-save as .xlsx).', true);
      return;
    }
    reset();
    setStatus('Reading ' + file.name + '…');
    Promise.resolve(window.readXlsxFile(file))
      .then(function (res) {
        var report = Payout.process(firstSheetRows(res));
        var pdf = buildPdf(report);
        var blob = pdf.output('blob');
        current = {
          report: report,
          blob: blob,
          url: URL.createObjectURL(blob),
          filename: report.month.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_SHOP_PURCHASE_ANALYSIS.pdf'
        };
        $('drop-sub').textContent = file.name + ' — choose another file to replace it';
        setStatus('');
        render(report);
      })
      .catch(function (err) {
        console.error(err);
        setStatus('Could not process the file: ' + (err && err.message ? err.message : err), true);
      });
  }

  function reset() {
    if (current && current.url) URL.revokeObjectURL(current.url);
    current = null;
    resultEl.hidden = true;
    previewEl.hidden = true;
    frame.removeAttribute('src');
    btnPreview.setAttribute('aria-pressed', 'false');
    btnPreview.textContent = 'Show print preview';
  }

  function render(r) {
    $('report-title').textContent = r.title;
    $('s-wh').textContent = r.warehouses.length;
    $('s-shops').textContent = r.grand.shops;
    $('s-cases').textContent = Payout.num(r.grand.cases);
    $('s-bottles').textContent = Payout.num(r.grand.bottles);

    var w = $('warnings');
    w.innerHTML = '';
    w.hidden = r.warnings.length === 0;
    if (r.warnings.length) {
      var p = document.createElement('p');
      p.textContent = 'Check before using this report';
      var ul = document.createElement('ul');
      r.warnings.forEach(function (t) {
        var li = document.createElement('li'); li.textContent = t; ul.appendChild(li);
      });
      w.appendChild(p); w.appendChild(ul);
    }

    $('excluded-sum').textContent = r.excludedRows + ' row(s) left out because the licensee is not a numbered shop (' +
      r.excludedNames.length + ' name(s)) — show list';
    var list = $('excluded-list');
    list.innerHTML = '';
    r.excludedNames.forEach(function (n) {
      var li = document.createElement('li'); li.textContent = n; list.appendChild(li);
    });
    $('excluded').hidden = r.excludedRows === 0;

    resultEl.hidden = false;
  }

  function safeName(s) {
    return s.replace(/[\\\/:*?"<>|–]+/g, '-').replace(/\s+/g, '_').replace(/_+-_+/g, '-').slice(0, 120);
  }

  // ---------- PDF ----------
  function buildPdf(r) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var M = 40;
    var y = M;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    var titleLines = doc.splitTextToSize(r.title, pageW - 2 * M);
    doc.text(titleLines, pageW / 2, y + 6, { align: 'center' });
    y += 6 + titleLines.length * 18;

    y += 8;

    var tableStyles = {
      theme: 'grid',
      margin: { left: M, right: M, bottom: 50 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, lineColor: [200, 205, 214], lineWidth: 0.5, textColor: 30 },
      headStyles: { fillColor: [31, 95, 139], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [235, 240, 246], textColor: 20, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 32, halign: 'right' },
        2: { cellWidth: 80, halign: 'right' },
        3: { cellWidth: 80, halign: 'right' }
      },
      showFoot: 'lastPage',
      rowPageBreak: 'avoid'
    };

    r.warehouses.forEach(function (w) {
      // Keep the warehouse heading with at least a few rows of its table.
      if (y > pageH - 130) { doc.addPage(); y = M; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(w.name, M, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(95);
      doc.text(w.shops.length + (w.shops.length === 1 ? ' shop' : ' shops'), pageW - M, y, { align: 'right' });
      doc.setTextColor(0);

      doc.autoTable(Object.assign({}, tableStyles, {
        startY: y + 6,
        head: [['#', 'Shop', 'Cases', 'Bottles']],
        body: w.shops.map(function (s, i) {
          return [i + 1, s.name, Payout.num(s.cases), Payout.num(s.bottles)];
        }),
        foot: [[{ content: 'Total for ' + w.name, colSpan: 2 }, Payout.num(w.total.cases), Payout.num(w.total.bottles)]],
        didParseCell: rightAlignFoot,
        margin: { left: M, right: M, bottom: 50, top: M + 18 },
        didDrawPage: function (data) {
          if (data.pageNumber > 1) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text(w.name + ' (continued)', M, M + 12);
          }
        }
      }));
      y = doc.lastAutoTable.finalY + 26;
    });

    // Summary by warehouse with grand total.
    if (y > pageH - 160) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Summary by warehouse', M, y);
    doc.autoTable(Object.assign({}, tableStyles, {
      startY: y + 6,
      head: [['#', 'Warehouse', 'Cases', 'Bottles']],
      body: r.warehouses.map(function (w, i) {
        return [i + 1, w.name + '  (' + w.shops.length + (w.shops.length === 1 ? ' shop)' : ' shops)'),
          Payout.num(w.total.cases), Payout.num(w.total.bottles)];
      }),
      foot: [[{ content: 'Grand total (' + r.grand.shops + ' shops)', colSpan: 2 },
        Payout.num(r.grand.cases), Payout.num(r.grand.bottles)]],
      didParseCell: rightAlignFoot
    }));

    // Page numbers.
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(r.title, M, pageH - 24, { maxWidth: pageW - 2 * M - 70 });
      doc.text('Page ' + p + ' of ' + n, pageW - M, pageH - 24, { align: 'right' });
    }
    doc.setProperties({ title: r.title });
    return doc;
  }

  function rightAlignFoot(data) {
    if (data.section === 'foot' && data.column.index >= 2) data.cell.styles.halign = 'right';
    if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right';
  }

  function todayStr() {
    var d = new Date();
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  }

  // ---------- events ----------
  fileInput.addEventListener('change', function () {
    handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  });

  $('btn-download').addEventListener('click', function () {
    if (!current) return;
    var a = document.createElement('a');
    a.href = current.url;
    a.download = current.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  btnPreview.addEventListener('click', function () {
    if (!current) return;
    var show = previewEl.hidden;
    previewEl.hidden = !show;
    btnPreview.setAttribute('aria-pressed', String(show));
    btnPreview.textContent = show ? 'Hide print preview' : 'Show print preview';
    if (show && frame.getAttribute('src') !== current.url) frame.src = current.url;
    if (show) previewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
