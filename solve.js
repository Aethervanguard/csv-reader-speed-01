// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Written from the reference's stated policy
// (RULES.txt), not by copying its code.
//
// Speed idea: the reference reads one character at a time. Most of a file
// is plain unquoted fields, so this parser works in bulk instead:
//   - a record with no quoted field is split on ',' in one C++ call;
//   - only quoted fields (and records holding a stray CR) go through a
//     careful per-field path, which itself finds the closing quote with
//     indexOf and only walks characters when the content holds a doubled
//     quote, a CR or a LF;
//   - the next '"' and the next '\r' are memoised (they only move
//     forward), so no scan ever re-reads text it already passed.
//
// Everything else mirrors the reference exactly: BOM drop, empty lines
// skipped, stray CR dropped with an error, unterminated quote read again
// as unquoted, junk after a closing quote appended, short/long rows
// padded or cut to the first record's width, errors in the order met.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Next '"' / '\r' at or after pos (-1: none known; recomputed when stale).
  let qNext = -1;
  let rNext = -1;

  // The record being read: the line it starts on, its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  const error = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // Reads an unquoted field starting at p with initial value v.
  // ended: 0 = comma, 1 = line break, 2 = end of text.
  // added counts the characters kept (for the quote_junk decision).
  function unquoted(p, v) {
    let added = 0;
    for (;;) {
      const cm = text.indexOf(',', p);
      const nl = text.indexOf('\n', p);
      const cr = text.indexOf('\r', p);
      let m = -1;
      let kind = 2;
      if (cm !== -1) {
        m = cm;
        kind = 0;
      }
      if (nl !== -1 && (m === -1 || nl < m)) {
        m = nl;
        kind = 1;
      }
      if (cr !== -1 && (m === -1 || cr < m)) {
        m = cr;
        kind = 3;
      }
      if (m === -1) {
        v += text.slice(p);
        added += len - p;
        pos = len;
        return { value: v, ended: 2, added };
      }
      if (kind === 0) {
        v += text.slice(p, m);
        added += m - p;
        pos = m + 1;
        return { value: v, ended: 0, added };
      }
      if (kind === 1) {
        v += text.slice(p, m);
        added += m - p;
        line++;
        pos = m + 1;
        return { value: v, ended: 1, added };
      }
      // kind === 3: a CR.
      if (text.charCodeAt(m + 1) === 10) {
        v += text.slice(p, m);
        added += m - p;
        line++;
        pos = m + 2;
        return { value: v, ended: 1, added };
      }
      // A CR not followed by LF is dropped (stray_cr); the field goes on.
      v += text.slice(p, m);
      added += m - p;
      error('stray_cr');
      p = m + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  // ended: 0 = comma, 1 = line break, 2 = end of text.
  function quoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: the next '"' that is not doubled.
    let close = -1;
    let doubled = false;
    let scan = open + 1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        doubled = true;
        scan = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      const f = unquoted(open + 1, '"');
      return { value: f.value, ended: f.ended };
    }

    let value;
    if (!doubled) {
      // Fast path: no doubled quote inside. Still need to know whether
      // the content holds a line break or a CR (each becomes one LF).
      const nlIn = text.indexOf('\n', open + 1);
      const hasNL = nlIn !== -1 && nlIn < close;
      const hasCR = rNext !== -1 && rNext < close;
      if (!hasNL && !hasCR) {
        value = text.slice(open + 1, close);
      } else {
        value = quotedContent(open + 1, close);
      }
    } else {
      value = quotedContent(open + 1, close);
    }

    pos = close + 1;
    if (pos >= len) return { value, ended: 2 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      return { value, ended: 0 };
    }
    if (c === 10) {
      pos++;
      line++;
      return { value, ended: 1 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      return { value, ended: 1 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = unquoted(pos, value);
    if (junk.added > 0) error('quote_junk');
    return { value: junk.value, ended: junk.ended };
  }

  // The content of a quoted field, [from, to): doubled quotes become one
  // quote, each CRLF or lone CR becomes one LF (and counts one line).
  // Only called when the content holds one of those.
  function quotedContent(from, to) {
    let v = '';
    let seg = from;
    let i = from;
    while (i < to) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        v += text.slice(seg, i) + '"';
        i += 2;
        seg = i;
        continue;
      }
      if (c === 13) {
        v += text.slice(seg, i) + '\n';
        line++;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) line++;
      i++;
    }
    v += text.slice(seg, to);
    return v;
  }

  // Parses the rest of a record field by field (the slow path, used when
  // the record holds a stray CR). Appends to `fields`; returns how the
  // record ended (0 = comma, never returned; 1 = line break, 2 = end)
  // and whether the last field read was quoted.
  function slowRecord(fields) {
    let lastQuoted = false;
    for (;;) {
      if (pos >= len) {
        fields.push('');
        return { ended: 2, quoted: false };
      }
      let f;
      if (text.charCodeAt(pos) === 34) {
        f = quoted();
        lastQuoted = true;
      } else {
        f = unquoted(pos, '');
        lastQuoted = false;
      }
      fields.push(f.value);
      if (f.ended === 0) continue;
      return { ended: f.ended, quoted: lastQuoted };
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = [];
    let ended;
    let lastQuoted = false;

    // Field loop: bulk unquoted runs, one quoted field at a time.
    for (;;) {
      if (pos >= len) {
        fields.push('');
        ended = 2;
        lastQuoted = false;
        break;
      }
      if (qNext < pos) qNext = text.indexOf('"', pos);
      if (rNext < pos) rNext = text.indexOf('\r', pos);
      const nl = text.indexOf('\n', pos);
      const limit = nl === -1 ? len : nl;

      // First '"' at a field start before the record ends (a '"' right
      // after a comma, or at the field's own start). A '"' elsewhere is
      // a literal inside an unquoted field.
      let q = qNext;
      while (q !== -1 && q < limit && q !== pos && text.charCodeAt(q - 1) !== 44) {
        q = text.indexOf('"', q + 1);
      }
      qNext = q;

      if (q === -1 || q >= limit) {
        // No quoted field starts in this record: take the rest in bulk.
        if (rNext !== -1 && rNext < limit) {
          if (nl !== -1 && rNext === nl - 1) {
            // CRLF ending: the record is clean up to the CR.
            const fs = text.slice(pos, nl - 1).split(',');
            if (fields.length === 0) fields = fs;
            else for (let i = 0; i < fs.length; i++) fields.push(fs[i]);
            line++;
            pos = nl + 1;
            ended = 1;
            lastQuoted = false;
            break;
          }
          // A stray CR sits in this record: parse it field by field.
          const s = slowRecord(fields);
          ended = s.ended;
          lastQuoted = s.quoted;
          break;
        }
        if (nl === -1) {
          const fs = text.slice(pos).split(',');
          if (fields.length === 0) fields = fs;
          else for (let i = 0; i < fs.length; i++) fields.push(fs[i]);
          pos = len;
          ended = 2;
        } else {
          const fs = text.slice(pos, nl).split(',');
          if (fields.length === 0) fields = fs;
          else for (let i = 0; i < fs.length; i++) fields.push(fs[i]);
          line++;
          pos = nl + 1;
          ended = 1;
        }
        lastQuoted = false;
        break;
      }

      // A quoted field starts at q. The run [pos, q) is plain fields
      // (plus the empty head of the quoted field, which split leaves as
      // a trailing '' to drop).
      if (rNext !== -1 && rNext < q) {
        // A stray CR sits before the quote: parse field by field.
        const s = slowRecord(fields);
        ended = s.ended;
        lastQuoted = s.quoted;
        break;
      }
      if (q > pos) {
        const fs = text.slice(pos, q).split(',');
        fs.pop(); // the empty head of the quoted field
        if (fields.length === 0) fields = fs;
        else for (let i = 0; i < fs.length; i++) fields.push(fs[i]);
      }
      pos = q;
      const f = quoted();
      fields.push(f.value);
      lastQuoted = true;
      if (f.ended === 0) continue;
      ended = f.ended;
      break;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
