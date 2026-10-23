(function () {
  'use strict';

  // Preserve empty cells, quoted commas/newlines and escaped double quotes.
  function parseCSV(input) {
    const text = String(input).replace(/^\uFEFF/, '');
    if (!text.trim() || /^\s*</.test(text)) throw new Error('ลิงก์ไม่ได้ส่งข้อมูล CSV กรุณาตรวจการเผยแพร่ชีต');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false, endedRow = false;
    const pushField = () => { row.push(field); field = ''; closed = false; };
    const pushRow = () => { pushField(); rows.push(row); row = []; endedRow = true; };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      endedRow = false;
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else { field += char; }
      } else if (char === ',') { pushField(); }
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        pushRow();
      } else if (char === '"' && field === '' && !closed) { quoted = true; }
      else {
        if (closed || char === '"') throw new Error('รูปแบบ CSV ไม่ถูกต้อง กรุณาตรวจลิงก์เผยแพร่');
        field += char;
      }
    }
    if (quoted) throw new Error('ข้อมูล CSV ไม่ครบ กรุณากดอัปเดตอีกครั้ง');
    if (!endedRow) { pushField(); rows.push(row); }
    return rows;
  }

  async function load() {
    let url;
    try {
      url = new URL(window.BKS_CONFIG.csvUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' ||
          !url.pathname.startsWith('/spreadsheets/d/e/') || url.searchParams.get('output') !== 'csv') throw new Error();
    } catch (_) { throw new Error('กรุณาตั้งลิงก์ CSV ที่เผยแพร่จาก Google Sheets ใน config.js'); }
    // This bypasses the browser cache, not Google's publication delay.
    url.searchParams.set('_bks', String(Date.now()));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url.href, {mode:'cors', credentials:'omit', cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('โหลด CSV ไม่สำเร็จ (' + response.status + ') กรุณาตรวจการเผยแพร่ชีต');
      const rows = parseCSV(await response.text());
      if (rows.length < 37 || !revenueText_((rows[0] || [])[0]) ||
          !revenueText_((rows[9] || [])[0]) || !revenueText_((rows[24] || [])[0])) {
        throw new Error('โครงสร้างข้อมูลไม่ตรงกับแท็บรายงาน กรุณาตรวจแท็บที่เผยแพร่เป็น CSV');
      }
      return buildRevenueOverview_(rows, rows[0][0]);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('โหลดข้อมูลนานเกินไป กรุณากดอัปเดตอีกครั้ง');
      if (error instanceof TypeError) throw new Error('เชื่อมต่อ CSV ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและลิงก์เผยแพร่');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function revenueNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  var clean = value.trim().replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)) return null;
  var number = Number(clean);
  return isFinite(number) ? number : null;
}
function revenueText_(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}
function revenueComparison_(rows, headingRow) {
  var heading = rows[headingRow - 1] || [];
  var previousLabel = heading.slice(0, 2).map(revenueText_).filter(Boolean).join(' ');
  var currentLabel = heading.slice(2, 4).map(revenueText_).filter(Boolean).join(' ');
  var months = [];
  for (var i = 0; i < 12; i++) {
    var row = rows[headingRow + i] || [];
    var previous = revenueNumber_(row[1]), current = revenueNumber_(row[3]);
    var previousMonth = revenueText_(row[0]), currentMonth = revenueText_(row[2]);
    var paired = previous !== null && current !== null && previousMonth === currentMonth && previousMonth !== '';
    months.push({label: previousMonth || currentMonth, previous: paired ? previous : null, current: paired ? current : null});
  }
  return {previousLabel: previousLabel, currentLabel: currentLabel, months: months};
}
function buildRevenueOverview_(rows, period) {
  var summaryLabels = ['รายได้ทั้งหมด', 'ค่าธรรมเนียมรถร่วม', 'ค่าเช่าพื้นที่', 'ค่าใช้สถานี', 'อื่นๆ'];
  var totals = summaryLabels.map(function(label, i) {
    var row = rows[i + 2] || [];
    return {label: revenueText_(row[0]) || label, value: revenueNumber_(row[1])};
  });
  var categories = [];
  for (var index = 40; index < 50; index++) {
    var row = rows[index] || [], label = revenueText_(row[0]), value = revenueNumber_(row[13]);
    if (label && value !== null) {
      if (value < 0) throw new Error('ยอดสัดส่วนรายได้ติดลบที่ N' + (index + 1));
      categories.push({label: label, value: value, row: index + 1});
    }
  }
  categories.sort(function(a, b) { return b.value - a.value || a.row - b.row; });
  var top = categories.slice(0, 5).map(function(item) { return {label: item.label, value: item.value}; });
  var remaining = categories.slice(5);
  if (remaining.length) top.push({label: 'อื่นๆ', value: remaining.reduce(function(sum, item) { return sum + item.value; }, 0)});
  return {demo: false, period: revenueText_(period), totals: totals,
    income: revenueComparison_(rows, 10), trips: revenueComparison_(rows, 25),
    categories: top, categoryTotal: categories.reduce(function(sum, item) { return sum + item.value; }, 0)};
}


  window.BKS_CSV = Object.freeze({parseCSV, load});
})();
