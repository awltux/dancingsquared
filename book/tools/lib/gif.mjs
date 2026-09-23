// A GIF89a writer: indexed frames, LZW compression, per-frame delays and an infinite loop.
//
// WHY HAND-WRITTEN. There is no image toolchain here -- no ImageMagick, no ffmpeg, no python
// image module, no node package -- and Chromium cannot start in the sandbox (its Mojo IPC needs
// named pipes: `platform_channel.cc:108 Check failed: Access is denied`). An animated GIF is
// therefore written from scratch, which also keeps the build dependency-free like the rest of
// this toolchain. GIF is a small format: a palette, LZW-compressed indices, and a handful of
// block types.

/** GIF packs the palette size as a power of two; this picks the smallest table that fits. */
function tableSizeFor(colours) {
  let bits = 1;
  while (1 << bits < colours) bits++;
  return Math.max(2, Math.min(8, bits)); // GIF's minimum table is 2 entries, maximum 256
}

/**
 * LZW-compress an index stream the way GIF wants it.
 *
 * Codes are emitted least-significant-bit first into a byte stream, and the code width grows from
 * `minCodeSize + 1` up to 12 bits, resetting via a clear code when the dictionary fills. The
 * 4096-entry ceiling is the format's, not a choice.
 */
export function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code, width) => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map();
  let next = endCode + 1;
  let codeWidth = minCodeSize + 1;

  const reset = () => {
    dict = new Map();
    next = endCode + 1;
    codeWidth = minCodeSize + 1;
  };

  emit(clearCode, codeWidth);
  reset();

  let prefix = indices.length ? indices[0] : null;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k; // prefix < 4096 and k < 256, so this key is unique
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix, codeWidth);
    if (next < 4096) {
      dict.set(key, next);
      next++;
      if (next - 1 === 1 << codeWidth && codeWidth < 12) codeWidth++;
    } else {
      emit(clearCode, codeWidth);
      reset();
    }
    prefix = k;
  }
  if (prefix !== null) emit(prefix, codeWidth);
  emit(endCode, codeWidth);

  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return Uint8Array.from(out);
}

/** Split a byte stream into GIF sub-blocks of at most 255 bytes, terminated by a zero. */
function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray(i, Math.min(i + 255, bytes.length));
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return Uint8Array.from(out);
}

/**
 * Build an animated GIF.
 *
 * @param {{width:number,height:number,palette:number[][],frames:Uint8Array[],delayMs:number,loop?:number}} spec
 *   `palette` is a list of [r,g,b]; `frames` are index buffers, each width*height long.
 */
export function encodeGif({ width, height, palette, frames, delayMs = 80, loop = 0 }) {
  const sizeBits = tableSizeFor(Math.max(palette.length, 2));
  const tableEntries = 1 << sizeBits;

  const bytes = [];
  const push = (...v) => bytes.push(...v);
  const push16 = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);

  // Header + Logical Screen Descriptor
  for (const ch of 'GIF89a') push(ch.charCodeAt(0));
  push16(width);
  push16(height);
  push(0xf0 | (sizeBits - 1)); // global colour table present, 8-bit colour resolution
  push(0); // background colour index
  push(0); // pixel aspect ratio

  // Global Colour Table, padded to the table size
  for (let i = 0; i < tableEntries; i++) {
    const c = palette[i] ?? [0, 0, 0];
    push(c[0], c[1], c[2]);
  }

  // Netscape looping extension
  push(0x21, 0xff, 0x0b);
  for (const ch of 'NETSCAPE2.0') push(ch.charCodeAt(0));
  push(0x03, 0x01);
  push16(loop);
  push(0x00);

  const delay = Math.max(2, Math.round(delayMs / 10)); // GIF delay is in hundredths of a second
  for (const frame of frames) {
    // Graphic Control Extension: disposal 1 (do not dispose) keeps the previous frame's pixels,
    // which is what a board animation wants -- the floor does not flicker between frames.
    push(0x21, 0xf9, 0x04, 0x04);
    push16(delay);
    push(0x00, 0x00);

    // Image Descriptor
    push(0x2c);
    push16(0);
    push16(0);
    push16(width);
    push16(height);
    push(0x00);

    const minCodeSize = Math.max(2, sizeBits);
    push(minCodeSize);
    push(...subBlocks(lzwEncode(frame, minCodeSize)));
  }

  push(0x3b); // trailer
  return Buffer.from(bytes);
}

/**
 * Decode a GIF89a back to its frames. This exists to PROVE the encoder, not to be a general
 * reader: an encoder with no decoder is a claim, and "it produced a file" is not evidence that a
 * browser can read it. `make-animations.mjs --verify` round-trips every animation through this.
 */
export function decodeGif(buf) {
  let p = 0;
  const header = buf.toString('latin1', 0, 6);
  if (header !== 'GIF89a' && header !== 'GIF87a') throw new Error(`not a GIF: ${JSON.stringify(header)}`);
  p = 6;
  const width = buf.readUInt16LE(p);
  const height = buf.readUInt16LE(p + 2);
  const packed = buf[p + 4];
  p += 7;
  let palette = null;
  if (packed & 0x80) {
    const entries = 1 << ((packed & 0x07) + 1);
    palette = [];
    for (let i = 0; i < entries; i++) {
      palette.push([buf[p], buf[p + 1], buf[p + 2]]);
      p += 3;
    }
  }

  const frames = [];
  let delay = 0;
  for (;;) {
    if (p >= buf.length) break;
    const block = buf[p];
    if (block === 0x3b) break; // trailer

    if (block === 0x21) {
      const label = buf[p + 1];
      if (label === 0xf9) {
        delay = buf.readUInt16LE(p + 4);
        p += 8;
      } else {
        p += 2;
        while (buf[p] !== 0) p += buf[p] + 1; // skip sub-blocks
        p += 1;
      }
      continue;
    }

    if (block === 0x2c) {
      const left = buf.readUInt16LE(p + 1);
      const top = buf.readUInt16LE(p + 3);
      const fw = buf.readUInt16LE(p + 5);
      const fh = buf.readUInt16LE(p + 7);
      const fpacked = buf[p + 9];
      p += 10;
      if (fpacked & 0x80) p += 3 * (1 << ((fpacked & 0x07) + 1)); // local colour table
      const minCodeSize = buf[p];
      p += 1;

      // Gather the LZW byte stream from the sub-blocks.
      const chunks = [];
      while (buf[p] !== 0) {
        const n = buf[p];
        chunks.push(buf.subarray(p + 1, p + 1 + n));
        p += n + 1;
      }
      p += 1;
      const lzw = Buffer.concat(chunks);

      const image = lzwDecode(lzw, minCodeSize, fw * fh);
      const full = new Uint8Array(width * height).fill(0);
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          full[(y + top) * width + (x + left)] = image[y * fw + x];
        }
      }
      frames.push(full);
      continue;
    }
    // An unknown block: stop rather than read garbage.
    break;
  }
  return { width, height, palette, delay, frames };
}

/** The inverse of lzwEncode, for verification only. */
export function lzwDecode(bytes, minCodeSize, expected) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out = new Uint8Array(expected);
  let outLen = 0;

  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); // clear
    dict.push([]); // end
  };
  let codeWidth = minCodeSize + 1;

  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;
  const readCode = () => {
    while (bitCount < codeWidth) {
      if (pos >= bytes.length) return endCode;
      bitBuffer |= bytes[pos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeWidth) - 1);
    bitBuffer >>= codeWidth;
    bitCount -= codeWidth;
    return code;
  };

  reset();
  let prev = null;
  for (;;) {
    const code = readCode();
    if (code === endCode) break;
    if (code === clearCode) {
      reset();
      codeWidth = minCodeSize + 1;
      prev = null;
      continue;
    }
    let entry;
    if (code < dict.length && dict[code].length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`bad LZW code ${code}`);
    for (const v of entry) {
      if (outLen < out.length) out[outLen++] = v;
    }
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << codeWidth && codeWidth < 12) codeWidth++;
    }
    prev = entry;
  }
  return out.subarray(0, outLen);
}
