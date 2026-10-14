//! Finds embedded JPEG previews inside camera RAW containers.
//! Mirrors `packages/core/src/rawPreview.ts`; both are tested against the same cases.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmbeddedJpeg {
    pub offset: usize,
    pub length: usize,
    pub width: u32,
    pub height: u32,
}

fn is_decodable_sof(m: u8) -> bool {
    matches!(m, 0xc0 | 0xc1 | 0xc2)
}

fn is_unsupported_sof(m: u8) -> bool {
    matches!(m, 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf)
}

pub fn parse_jpeg_at(data: &[u8], start: usize) -> Option<EmbeddedJpeg> {
    let n = data.len();
    if start + 4 > n || data[start] != 0xff || data[start + 1] != 0xd8 || data[start + 2] != 0xff {
        return None;
    }
    let mut p = start + 2;
    let (mut width, mut height, mut saw_sof) = (0u32, 0u32, false);
    while p < n {
        if data[p] != 0xff {
            return None;
        }
        while p < n && data[p] == 0xff {
            p += 1;
        }
        if p >= n {
            return None;
        }
        let marker = data[p];
        p += 1;
        if marker == 0xd9 {
            return saw_sof.then_some(EmbeddedJpeg { offset: start, length: p - start, width, height });
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if marker == 0xd8 || marker == 0x00 || p + 2 > n {
            return None;
        }
        let len = ((data[p] as usize) << 8) | data[p + 1] as usize;
        if len < 2 || p + len > n || is_unsupported_sof(marker) {
            return None;
        }
        if is_decodable_sof(marker) {
            if len < 8 {
                return None;
            }
            height = ((data[p + 3] as u32) << 8) | data[p + 4] as u32;
            width = ((data[p + 5] as u32) << 8) | data[p + 6] as u32;
            if width == 0 || height == 0 {
                return None;
            }
            saw_sof = true;
        }
        p += len;
        if marker == 0xda {
            if !saw_sof {
                return None;
            }
            loop {
                let ff = p + data[p..].iter().position(|&b| b == 0xff)?;
                if ff + 1 >= n {
                    return None;
                }
                let next = data[ff + 1];
                if next == 0x00 || (0xd0..=0xd7).contains(&next) {
                    p = ff + 2;
                } else if next == 0xff {
                    p = ff + 1;
                } else {
                    p = ff;
                    break;
                }
            }
        }
    }
    None
}

pub fn find_embedded_jpegs(data: &[u8], max: usize) -> Vec<EmbeddedJpeg> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 3 < data.len() && out.len() < max {
        let Some(rel) = data[i..].iter().position(|&b| b == 0xff) else { break };
        let ff = i + rel;
        if ff + 2 >= data.len() {
            break;
        }
        if data[ff + 1] == 0xd8 && data[ff + 2] == 0xff {
            if let Some(j) = parse_jpeg_at(data, ff) {
                i = ff + j.length;
                out.push(j);
                continue;
            }
        }
        i = ff + 1;
    }
    out
}

pub fn largest_embedded_jpeg(data: &[u8]) -> Option<EmbeddedJpeg> {
    find_embedded_jpegs(data, 16)
        .into_iter()
        .max_by_key(|j| j.width as u64 * j.height as u64)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn fake_jpeg(width: u16, height: u16, sof: u8) -> Vec<u8> {
        let mut v = vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, b'J', b'F', b'I', b'F'];
        v.extend_from_slice(&[0xff, sof, 0x00, 0x11, 0x08]);
        v.extend_from_slice(&height.to_be_bytes());
        v.extend_from_slice(&width.to_be_bytes());
        v.extend_from_slice(&[0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
        v.extend_from_slice(&[0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
        v.extend_from_slice(&[0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
        v
    }

    fn noise(n: usize, seed: u32) -> Vec<u8> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fff_ffff;
                (s & 0xff) as u8
            })
            .collect()
    }

    #[test]
    fn picks_largest_preview() {
        let mut raw = vec![0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0xff, 0xd8, 0x00, 0x13];
        raw.extend(noise(500, 7));
        raw.extend(fake_jpeg(160, 120, 0xc0));
        raw.extend(noise(300, 7));
        let full = fake_jpeg(8256, 5504, 0xc0);
        raw.extend(&full);
        raw.extend(noise(1000, 3));
        raw.extend(fake_jpeg(1620, 1080, 0xc0));
        let found = find_embedded_jpegs(&raw, 16);
        assert_eq!(found.iter().map(|j| j.width).collect::<Vec<_>>(), vec![160, 8256, 1620]);
        let best = largest_embedded_jpeg(&raw).unwrap();
        assert_eq!(&raw[best.offset..best.offset + best.length], &full[..]);
    }

    #[test]
    fn skips_lossless_and_truncated() {
        let mut raw = fake_jpeg(8000, 6000, 0xc3);
        let preview = fake_jpeg(1620, 1080, 0xc0);
        raw.extend(&preview[..preview.len() - 3]);
        assert!(largest_embedded_jpeg(&raw).is_none());
        raw.extend(fake_jpeg(1024, 683, 0xc2));
        assert_eq!(largest_embedded_jpeg(&raw).unwrap().width, 1024);
    }

    #[test]
    fn noise_has_no_preview() {
        assert!(largest_embedded_jpeg(&noise(10_000, 1)).is_none());
    }
}
