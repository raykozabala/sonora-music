import zlib
import struct
import math
import os

def create_png(width, height, get_pixel_func):
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0) # filter byte 0 (None)
        for x in range(width):
            r, g, b, a = get_pixel_func(x, y, width, height)
            raw_data.extend([int(r), int(g), int(b), int(a)])
    
    compressed = zlib.compress(bytes(raw_data), 9)
    
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    png.extend(struct.pack('>I', len(ihdr_data)))
    png.extend(b'IHDR')
    png.extend(ihdr_data)
    png.extend(struct.pack('>I', ihdr_crc))
    
    # IDAT
    idat_crc = zlib.crc32(b'IDAT' + compressed)
    png.extend(struct.pack('>I', len(compressed)))
    png.extend(b'IDAT')
    png.extend(compressed)
    png.extend(struct.pack('>I', idat_crc))
    
    # IEND
    iend_crc = zlib.crc32(b'IEND')
    png.extend(struct.pack('>I', 0))
    png.extend(b'IEND')
    png.extend(struct.pack('>I', iend_crc))
    
    return bytes(png)

def get_icon_pixel(x, y, w, h):
    nx = x / float(w)
    ny = y / float(h)
    
    # Corner radius calculation (rounded squircle / oval)
    corner_r = 0.22
    dx = max(0.0, abs(nx - 0.5) - (0.5 - corner_r))
    dy = max(0.0, abs(ny - 0.5) - (0.5 - corner_r))
    dist = math.sqrt(dx*dx + dy*dy)
    
    if dist > corner_r:
        return 0, 0, 0, 0 # transparent outside
    
    # Warm gradient from #FF3E2E (top-left) to #FF4757 (center) to #FF6B35 (bottom-right)
    t = (nx + ny) / 2.0
    if t < 0.5:
        p = t / 0.5
        r = 255
        g = int(62 + (71 - 62) * p)
        b = int(46 + (87 - 46) * p)
    else:
        p = (t - 0.5) / 0.5
        r = 255
        g = int(71 + (107 - 71) * p)
        b = int(87 + (53 - 87) * p)
        
    # Musical note shape
    # Center note head 1: center around (0.40, 0.65), radius rx=0.10, ry=0.075, angle tilted
    # Center note head 2: center around (0.65, 0.58), radius rx=0.10, ry=0.075
    # Stems: x=0.48, from y=0.28 to y=0.65; x=0.73, from y=0.28 to y=0.58
    # Beam: from (0.48, 0.28) to (0.75, 0.24) with thickness 0.08
    
    is_note = False
    
    # Head 1
    h1x = nx - 0.38
    h1y = ny - 0.65
    # rotate -25 deg
    rad = math.radians(25)
    rot_x = h1x * math.cos(rad) + h1y * math.sin(rad)
    rot_y = -h1x * math.sin(rad) + h1y * math.cos(rad)
    if (rot_x / 0.09)**2 + (rot_y / 0.065)**2 <= 1.0:
        is_note = True
        
    # Head 2
    h2x = nx - 0.62
    h2y = ny - 0.58
    rot2_x = h2x * math.cos(rad) + h2y * math.sin(rad)
    rot2_y = -h2x * math.sin(rad) + h2y * math.cos(rad)
    if (rot2_x / 0.09)**2 + (rot2_y / 0.065)**2 <= 1.0:
        is_note = True
        
    # Stem 1
    if 0.44 <= nx <= 0.485 and 0.27 <= ny <= 0.65:
        is_note = True
        
    # Stem 2
    if 0.68 <= nx <= 0.725 and 0.21 <= ny <= 0.58:
        is_note = True
        
    # Beam connecting stems
    if 0.44 <= nx <= 0.725:
        progress = (nx - 0.44) / (0.725 - 0.44)
        beam_top = 0.27 - progress * 0.06
        beam_bot = beam_top + 0.08
        if beam_top <= ny <= beam_bot:
            is_note = True
            
    if is_note:
        return 255, 255, 255, 255
    
    # Smooth edge antialiasing for corners
    edge_dist = corner_r - dist
    alpha = 255
    if edge_dist < 0.015:
        alpha = int(255 * max(0.0, edge_dist / 0.015))
        
    return r, g, b, alpha

out_dir = "/Users/rayko/Documents/Codex/2026-07-20/sonora-music/public/icons"
sizes = [72, 96, 128, 144, 152, 192, 384, 512]

for s in sizes:
    png_bytes = create_png(s, s, get_icon_pixel)
    path = os.path.join(out_dir, f"icon-{s}.png")
    with open(path, "wb") as f:
        f.write(png_bytes)
    print(f"Generated {path} ({s}x{s})")

print("All icons successfully generated!")
