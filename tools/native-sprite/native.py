"""Run an original engine's world-sprite draw under Unicorn and return the canvas."""
import os, struct, pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UcError
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP

HEAP, HEAP_SIZE = 0x10000000, 0x01000000
STACK, STACK_SIZE = 0x20000000, 0x00100000
STUBS = 0x30000000
SENTINEL = STUBS + 0xF00

class Engine:
    def __init__(self, path, cfg):
        self.cfg = cfg
        pe = pefile.PE(path)
        base = pe.OPTIONAL_HEADER.ImageBase
        size = (pe.OPTIONAL_HEADER.SizeOfImage + 0xFFF) & ~0xFFF
        uc = Uc(UC_ARCH_X86, UC_MODE_32)
        uc.mem_map(base, size)
        for s in pe.sections:
            data = s.get_data()[: max(s.Misc_VirtualSize, s.SizeOfRawData)]
            uc.mem_write(base + s.VirtualAddress, data)
        uc.mem_map(HEAP, HEAP_SIZE); uc.mem_map(STACK, STACK_SIZE); uc.mem_map(STUBS, 0x1000)
        uc.mem_write(STUBS, b"\xc3" * 0x1000)  # every stub is a bare ret
        self.stubs = {}
        for i, (iat, fn) in enumerate(cfg["imports"].items()):
            addr = STUBS + 0x10 * (i + 1)
            uc.mem_write(iat, struct.pack("<I", addr))
            # Win32 imports are stdcall: the stub pops its own arguments
            uc.mem_write(addr, b"\xc2" + struct.pack("<H", 8 if fn == "alloc" else 4))
            self.stubs[addr] = fn
        self.traps = set(cfg.get("traps", []))
        self.mask_ptr = HEAP + HEAP_SIZE - 0x40000
        # internal helpers replaced by stand-ins: lock answers its argument
        # (handles are pointers here), unlock does nothing, alloc answers the mask
        for addr, kind in cfg.get("patches", {}).items():
            code = {"lock": b"\x8b\x44\x24\x04\xc3", "unlock": b"\xc3",
                    "alloc": b"\xb8" + struct.pack("<I", self.mask_ptr) + b"\xc3"}[kind]
            uc.mem_write(addr, code)
        for addr, size, value in cfg.get("pokes", []):
            uc.mem_write(addr, value.to_bytes(size, "little"))
        uc.hook_add(UC_HOOK_CODE, self._hook)
        self.uc = uc
        self.heap = HEAP
        self.mask_handle = self.mask_ptr
        self.call(cfg["init"], [])

    def alloc(self, n):
        p = self.heap; self.heap += (n + 15) & ~15
        return p

    def _hook(self, uc, addr, size, _):
        if addr in self.stubs:
            esp = uc.reg_read(UC_X86_REG_ESP)
            arg0 = struct.unpack("<I", uc.mem_read(esp + 4, 4))[0]
            kind = self.stubs[addr]
            # handles ARE pointers here: GlobalLock answers its argument
            uc.reg_write(UC_X86_REG_EAX, arg0 if kind == "lock" else self.mask_handle if kind == "alloc" else 1)
        elif addr in self.traps:
            raise RuntimeError(f"engine error routine 0x{addr:x} reached")

    def call(self, fn, args):
        uc = self.uc
        esp = STACK + STACK_SIZE - 0x100
        frame = struct.pack("<I", SENTINEL) + b"".join(struct.pack("<I", a & 0xFFFFFFFF) for a in args)
        esp -= len(frame)
        uc.mem_write(esp, frame)
        uc.reg_write(UC_X86_REG_ESP, esp)
        uc.emu_start(fn, SENTINEL, count=50_000_000)

    def w16(self, a, v): self.uc.mem_write(a, struct.pack("<h", v))
    def w32(self, a, v): self.uc.mem_write(a, struct.pack("<I", v & 0xFFFFFFFF))

    def draw(self, sprite, ax, ay, dw, dh, flip, canvas_w, canvas_h, clip=None, mask=None, level=0):
        """sprite: the raw record bytes. Returns the canvas bytes; 0xEE = untouched."""
        c = self.cfg
        spr = self.alloc(len(sprite)); self.uc.mem_write(spr, bytes(sprite))
        bits = self.alloc(canvas_w * canvas_h); self.uc.mem_write(bits, b"\xee" * (canvas_w * canvas_h))
        bm = self.alloc(16); self.w16(bm + 2, canvas_w); self.w32(bm + 4, bits)
        top, left, bottom, right = clip or (0, 0, canvas_h, canvas_w)
        g = c["clip"]
        self.w16(g + 0, top); self.w16(g + 2, left); self.w16(g + 4, bottom); self.w16(g + 6, right)
        self.w32(c["mask_on"], 1 if mask is not None else 0)
        if mask is not None:
            self.uc.mem_write(self.mask_handle, bytes(mask))
        self.w32(c["mask_handle"], self.mask_handle)
        self.call(c["draw"], [spr, (ay & 0xFFFF) | ((ax & 0xFFFF) << 16), bm, flip, level, (dh & 0xFFFF) | ((dw & 0xFFFF) << 16)])
        self.heap = spr  # the draw's buffers are scratch: reuse the space
        return bytes(self.uc.mem_read(bits, canvas_w * canvas_h))

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
TI = os.path.join(ROOT, "taoot/gamefiles/ru/titanic1/INSTALL/BIN/TI.EXE")
TL = os.path.join(ROOT, "timelapse/gamefiles/TLAPSE1/install/bin/tl.exe")
DF = os.path.join(ROOT, "dust/gamefiles/dustcd/INSTALL/ALT31/DF.EXE")
CONFIGS = {
    "df": {
        "draw": 0x415B30, "init": 0x4156B0,
        "imports": {0x46244C: "lock", 0x462450: "unlock", 0x462444: "alloc"},
        "traps": [0x425FF0],
        "clip": 0x460848, "mask_handle": 0x460850, "mask_on": 0x460E10,
    },
    "ti": {
        "draw": 0x412280, "init": 0x411D70, "imports": {},
        "patches": {0x434C10: "lock", 0x434C40: "unlock", 0x434A70: "alloc"},
        "traps": [0x41EB90],
        "clip": 0x48A060, "mask_handle": 0x48A068, "mask_on": 0x48A054,
    },
    "tl": {
        "draw": 0x43E9F0, "init": 0x43E4E0, "imports": {},
        "patches": {0x4425B0: "lock", 0x4425E0: "unlock", 0x442410: "alloc"},
        "traps": [0x409310],
        "clip": 0x466450, "mask_handle": 0x466458, "mask_on": 0x466448,
    },
}
PATHS = {"df": DF, "ti": TI, "tl": TL}
