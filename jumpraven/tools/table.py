# print n dwords at a VA of RAVEN.EXE:  python3 jumpraven/tools/table.py 0x43141c 15
import struct, sys
d = open('jumpraven/gamefiles/RAVEN/RAVEN/RAVEN.EXE', 'rb').read()
pe = struct.unpack_from('<I', d, 0x3c)[0]; n = struct.unpack_from('<H', d, pe + 6)[0]; opt = struct.unpack_from('<H', d, pe + 20)[0]
secs = [struct.unpack_from('<IIII', d, pe + 24 + opt + i * 40 + 8) for i in range(n)]
def off(va):
    r = va - 0x400000
    for vs, v, rs, raw in secs:
        if v <= r < v + max(vs, rs): return raw + r - v
va, k = int(sys.argv[1], 16), int(sys.argv[2])
fmt = sys.argv[3] if len(sys.argv) > 3 else 'I'
vals = struct.unpack_from('<%d%s' % (k, fmt), d, off(va))
print(' '.join(hex(x) if fmt in 'I' else str(x) for x in vals))
