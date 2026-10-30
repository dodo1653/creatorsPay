# CreatorPay's coin, part 1: a thick glossy coin in electric lime with the CreatorPay mark (a rounded play triangle,
# pointing right) raised on its face in near-black enamel, inside a raised rim, and a reeded edge. Rendered on a transparent film; art/compose.py puts it on the background. A .glb output exports the
# same coin (both faces marked) for the three.js film.
# blender -b --factory-startup --python art/coin.py -- <out.png|out.glb> [samples] [res] [yaw_deg] [pitch_deg]
import bpy, bmesh, math, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.abspath("coin_raw.png")
SAMPLES = int(argv[1]) if len(argv) > 1 else 192
RES = int(argv[2]) if len(argv) > 2 else 1400
YAW = math.radians(float(argv[3])) if len(argv) > 3 else math.radians(-22)
PITCH = math.radians(float(argv[4])) if len(argv) > 4 else math.radians(9)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene

def srgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def P(m): return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
def setin(p, names, v):
    for n in names:
        if n in p.inputs: p.inputs[n].default_value = v; return
def mat(name, hexcol, rough, coat=0.0, metal=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True; p = P(m)
    p.inputs["Base Color"].default_value = (*srgb(hexcol), 1); p.inputs["Roughness"].default_value = rough; p.inputs["Metallic"].default_value = metal
    setin(p, ["Coat Weight", "Clearcoat"], coat); setin(p, ["Coat Roughness", "Clearcoat Roughness"], 0.06); setin(p, ["Specular IOR Level", "Specular"], spec)
    return m

# ---- materials
FACE = mat("face", "#c6f53a", 0.3, coat=0.9)
nt = FACE.node_tree; tc = nt.nodes.new("ShaderNodeTexCoord"); wv = nt.nodes.new("ShaderNodeTexWave")
wv.wave_type = "RINGS"; wv.inputs["Scale"].default_value = 9; wv.inputs["Distortion"].default_value = 0.6; wv.inputs["Detail"].default_value = 2
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.05; bump.inputs["Distance"].default_value = 0.002
nt.links.new(tc.outputs["Object"], wv.inputs["Vector"]); nt.links.new(wv.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], P(FACE).inputs["Normal"])
EDGE = mat("edge", "#9fcc1c", 0.28, coat=0.7)
nt = EDGE.node_tree; tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
at = nt.nodes.new("ShaderNodeMath"); at.operation = "ARCTAN2"; mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 110
sn = nt.nodes.new("ShaderNodeMath"); sn.operation = "SINE"; bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.55; bump.inputs["Distance"].default_value = 0.01
nt.links.new(tc.outputs["Object"], sep.inputs["Vector"]); nt.links.new(sep.outputs["Y"], at.inputs[0]); nt.links.new(sep.outputs["X"], at.inputs[1])
nt.links.new(at.outputs["Value"], mul.inputs[0]); nt.links.new(mul.outputs["Value"], sn.inputs[0]); nt.links.new(sn.outputs["Value"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], P(EDGE).inputs["Normal"])
RIM = mat("rim", "#efffc0", 0.2, coat=1.0)
INK = mat("ink", "#0a0c0d", 0.18, coat=1.0, spec=0.6)

# ---- the coin: a bevelled disc, faces and edge on separate materials
TH = 0.24
bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=1.0, depth=TH)
coin = bpy.context.active_object; coin.data.materials.append(FACE); coin.data.materials.append(EDGE)
for poly in coin.data.polygons: poly.material_index = 0 if abs(poly.normal.z) > 0.5 else 1
bv = coin.modifiers.new("bevel", "BEVEL"); bv.width = 0.035; bv.segments = 6; bv.limit_method = "ANGLE"; bv.harden_normals = False
bpy.ops.object.shade_smooth()
for s in (1, -1):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.875, minor_radius=0.04, major_segments=256, minor_segments=24, location=(0, 0, s * TH / 2))
    r = bpy.context.active_object; r.scale.z = 0.7; r.data.materials.append(RIM); bpy.ops.object.shade_smooth(); r.parent = coin

FZ = TH / 2; H = 0.075
def raised(pts, side, bevel=0.014):
    # a convex outline (front-face coordinates, y up) given depth on the face; mirrored in x on the back
    me = bpy.data.meshes.new("mark"); bm = bmesh.new(); z0 = side * (FZ - 0.01)
    f = bm.faces.new([bm.verts.new((side * x, y, z0)) for x, y in (pts if side > 0 else pts[::-1])])
    ex = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, 0, side * H), verts=[v for v in ex["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("mark", me); sc.collection.objects.link(o)
    m = o.modifiers.new("soft", "BEVEL"); m.width = bevel; m.segments = 5; m.limit_method = "ANGLE"
    o.data.materials.append(INK); o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons)); o.parent = coin

def rounded_triangle(R, r, cx, n=24):
    # an equilateral triangle pointing right (circumradius R, centred at x = cx), each corner rounded with radius r
    pts = []
    for k in range(3):
        a = math.radians(k * 120)                                      # corner directions: 0 (right), 120, 240
        c = (cx + (R - 2 * r) * math.cos(a), (R - 2 * r) * math.sin(a))  # the corner arc's centre, pulled inside
        for i in range(n + 1):
            t = a - math.radians(60) + math.radians(120) * i / n         # each corner turns 120 degrees
            pts.append((c[0] + r * math.cos(t), c[1] + r * math.sin(t)))
    return pts

# the play mark: optically centred (a right-pointing triangle sits a little right of its circumcentre's balance)
TRI = rounded_triangle(0.66, 0.095, -0.065)
def tick(a, r0=0.76, r1=0.815, w=0.022):
    c, s = math.cos(a), math.sin(a); nx, ny = -s, c
    return [(c * r0 + nx * w, s * r0 + ny * w), (c * r1 + nx * w, s * r1 + ny * w), (c * r1 - nx * w, s * r1 - ny * w), (c * r0 - nx * w, s * r0 - ny * w)]
for side in ((1, -1) if OUT.endswith(".glb") else (1,)):
    raised(TRI, side)

if OUT.endswith(".glb"):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True)
    print("wrote", OUT); sys.exit(0)
coin.rotation_euler = (math.radians(90) + PITCH, 0, YAW)

# ---- light
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bgn = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND"); bgn.inputs["Color"].default_value = (*srgb("#1a1f12"), 1); bgn.inputs["Strength"].default_value = 0.6
def area(loc, size, power, col):
    bpy.ops.object.light_add(type="AREA", location=loc); l = bpy.context.active_object
    l.data.size = size; l.data.energy = power; l.data.color = srgb(col)
    import mathutils
    d = mathutils.Vector((0, 0, 0)) - l.location; l.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return l
area((-3.2, -4.0, 3.0), 4.0, 900, "#ffffff")
area((3.5, 2.5, 2.2), 2.5, 700, "#f0ffc0")
area((2.5, -4.5, -2.0), 3.0, 220, "#f7ffe0")
area((0, -1.0, 4.5), 2.0, 260, "#ffffff")
bpy.ops.object.camera_add(location=(0, -7.2, 0)); cam = bpy.context.active_object; cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.lens = 96; sc.camera = cam
sc.render.engine = "CYCLES"; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
try: sc.cycles.device = "GPU"
except Exception: pass
sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"; sc.view_settings.exposure = -0.4; sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"; sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
