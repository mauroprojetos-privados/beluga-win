//! Windows has no Dock badge: the count of what's new goes on the taskbar button as an overlay
//! icon instead (`set_overlay_icon`), a 16×16 soft red dot with the number in white.
//! Drawn here so it needs no image files; 10 or more reads "9+".
#![cfg_attr(not(windows), allow(dead_code))]

/// The overlay's side, in pixels (Windows draws taskbar overlays at 16×16).
pub const SIDE: u32 = 16;

/// 3×5 digits (and "+"), one row per byte, the three low bits left to right.
const GLYPHS: [[u8; 5]; 11] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b010, 0b010, 0b010], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
    [0b000, 0b010, 0b111, 0b010, 0b000], // +
];

/// What the badge says: "1"…"9", then "9+".
pub fn label(count: u32) -> Vec<usize> {
    match count {
        0 => vec![],
        1..=9 => vec![count as usize],
        _ => vec![9, 10],
    }
}

/// The overlay's RGBA pixels for `count` (`None` for 0: no overlay).
pub fn overlay_rgba(count: u32) -> Option<Vec<u8>> {
    let glyphs = label(count);
    if glyphs.is_empty() {
        return None;
    }
    let side = SIDE as usize;
    let mut px = vec![0u8; side * side * 4];
    // The dot: a filled circle with a soft edge (coverage from the distance to the rim).
    let c = (SIDE as f32 - 1.0) / 2.0;
    let r = SIDE as f32 / 2.0;
    for y in 0..side {
        for x in 0..side {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            let a = (r - d).clamp(0.0, 1.0);
            let i = (y * side + x) * 4;
            px[i..i + 4].copy_from_slice(&[0xE5, 0x4B, 0x4B, (a * 255.0) as u8]);
        }
    }
    // The number: one digit at 2× (6×10), two at 1× side by side with a gap, centred.
    let scale = if glyphs.len() == 1 { 2 } else { 1 };
    let width = glyphs.len() * 3 * scale + (glyphs.len() - 1);
    let height = 5 * scale;
    let (x0, y0) = ((side - width) / 2, (side - height) / 2);
    for (n, g) in glyphs.iter().enumerate() {
        let gx = x0 + n * (3 * scale + 1);
        for (row, bits) in GLYPHS[*g].iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let (x, y) = (gx + col * scale + dx, y0 + row * scale + dy);
                        let i = (y * side + x) * 4;
                        px[i..i + 4].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
                    }
                }
            }
        }
    }
    Some(px)
}

/// Puts the count on the window's taskbar button (or takes it off at 0).
#[cfg(windows)]
pub fn show(window: &tauri::WebviewWindow, count: u32) {
    let icon = overlay_rgba(count).map(|rgba| tauri::image::Image::new_owned(rgba, SIDE, SIDE));
    let _ = window.set_overlay_icon(icon);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_new_has_no_overlay() {
        assert!(overlay_rgba(0).is_none());
    }

    #[test]
    fn says_the_count_then_nine_plus() {
        assert_eq!(label(3), vec![3]);
        assert_eq!(label(9), vec![9]);
        assert_eq!(label(10), vec![9, 10]);
        assert_eq!(label(250), vec![9, 10]);
    }

    #[test]
    fn a_16_pixel_dot_with_white_in_the_middle() {
        for count in [1, 7, 42] {
            let px = overlay_rgba(count).unwrap();
            assert_eq!(px.len(), (SIDE * SIDE * 4) as usize);
            // The corners are see-through, the dot isn't.
            assert_eq!(px[3], 0);
            let white = px.chunks(4).filter(|p| p == &[0xFF, 0xFF, 0xFF, 0xFF]).count();
            assert!(white > 4, "{count}: the number is drawn");
        }
    }
}
