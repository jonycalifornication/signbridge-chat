
import json
import struct
import base64
import math
import sys
import os

# --- 1. Bone Schema (Matches bone-schema.js) ---
BONE_ORDER = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftEye', 'rightEye',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
    
    # Fingers Left
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',

    # Fingers Right
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
]

# --- 2. Math Helpers (Quaternion SLERP) ---
def q_slerp(qa, qb, t):
    """Simple SLERP implementation for quaternions [x, y, z, w]."""
    # Calculate cosine of angle between them
    cos_half_theta = qa[0]*qb[0] + qa[1]*qb[1] + qa[2]*qb[2] + qa[3]*qb[3]

    # If qb is on opposite side, invert it
    if cos_half_theta < 0:
        qb = [-x for x in qb]
        cos_half_theta = -cos_half_theta

    if abs(cos_half_theta) >= 1.0:
        return qa

    sin_half_theta = math.sqrt(1.0 - cos_half_theta*cos_half_theta)

    if abs(sin_half_theta) < 0.001:
        return [
            (1-t)*qa[0] + t*qb[0],
            (1-t)*qa[1] + t*qb[1],
            (1-t)*qa[2] + t*qb[2],
            (1-t)*qa[3] + t*qb[3]
        ]
    
    half_theta = math.acos(cos_half_theta)
    ratio_a = math.sin((1 - t) * half_theta) / sin_half_theta
    ratio_b = math.sin(t * half_theta) / sin_half_theta
    
    return [
        qa[0]*ratio_a + qb[0]*ratio_b,
        qa[1]*ratio_a + qb[1]*ratio_b,
        qa[2]*ratio_a + qb[2]*ratio_b,
        qa[3]*ratio_a + qb[3]*ratio_b
    ]

def v_lerp(va, vb, t):
    """Linear interpolation for vectors."""
    return [
        va[0] + (vb[0] - va[0]) * t,
        va[1] + (vb[1] - va[1]) * t,
        va[2] + (vb[2] - va[2]) * t
    ]

# --- 3. GLTF Parser Helpers ---
def get_buffer_data(gltf, buffer_index, base_path):
    """Reads binary data from buffer."""
    buf_def = gltf['buffers'][buffer_index]
    uri = buf_def.get('uri')
    
    if not uri:
        # Assuming integrated GLB binary chunk if no URI
        # For simplicity, this script expects standard .gltf with external .bin OR .glb
        # Handling .glb internal buffer requires parsing GLB header.
        return None 
    
    if uri.startswith('data:'):
        # Data URI
        header, encoded = uri.split(',', 1)
        return base64.b64decode(encoded)
    else:
        # External File
        path = os.path.join(base_path, uri)
        with open(path, 'rb') as f:
            return f.read()

def get_accessor_data(gltf, accessor_index, buffers):
    """Extracts values from accessor."""
    acc = gltf['accessors'][accessor_index]
    buf_view = gltf['bufferViews'][acc['bufferView']]
    buffer_data = buffers[buf_view['buffer']]
    
    offset = (buf_view.get('byteOffset', 0)) + (acc.get('byteOffset', 0))
    count = acc['count']
    comp_type = acc['componentType'] # 5126=FLOAT, 5123=USHORT...
    type_str = acc['type'] # SCALAR, VEC3, VEC4...
    
    # Map to struct codes
    # We assume FLOAT (5126) for animations usually.
    if comp_type != 5126:
        raise ValueError(f"Unsupported component type: {comp_type}")

    comp_count_map = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    comp_count = comp_count_map[type_str]
    stride = 4 * comp_count # 4 bytes per float
    
    values = []
    current_off = offset
    for _ in range(count):
        chunk = buffer_data[current_off : current_off + stride]
        floats = struct.unpack(f'<{comp_count}f', chunk)
        values.append(list(floats) if comp_count > 1 else floats[0])
        current_off += stride
        
    return values

# --- 4. Main Conversion Logic ---
def convert_vrma(file_path):
    base_dir = os.path.dirname(file_path)
    
    # Simple GLB Parsing (Skip header)
    with open(file_path, 'rb') as f:
        magic = f.read(4)
        if magic == b'glTF':
            # Is GLB
            version = struct.unpack('<I', f.read(4))[0]
            length = struct.unpack('<I', f.read(4))[0]
            
            # Read JSON Chunk
            chunk_len = struct.unpack('<I', f.read(4))[0]
            chunk_type = f.read(4) # JSON
            json_bytes = f.read(chunk_len)
            gltf = json.loads(json_bytes)
            
            # Read BIN Chunk
            chunk_len_bin = struct.unpack('<I', f.read(4))[0]
            chunk_type_bin = f.read(4) # BIN
            bin_data = f.read(chunk_len_bin)
            
            buffers = [bin_data] # GLB uses index 0 for binary chunk
        else:
            # Is GLTF (JSON)
            f.seek(0)
            gltf = json.load(f)
            buffers = []
            for i in range(len(gltf.get('buffers', []))):
                buffers.append(get_buffer_data(gltf, i, base_dir))

    # Parse Extension for Bone Mapping
    human_bones = {}
    if 'extensions' in gltf and 'VRMC_vrm_animation' in gltf['extensions']:
        hb_def = gltf['extensions']['VRMC_vrm_animation']['humanoid']['humanBones']
        for name, data in hb_def.items():
            human_bones[name] = data['node'] # Map humanBoneName -> nodeIndex
    
    # Parse Animations
    if not gltf.get('animations'):
        print("No animations found")
        return None
        
    anim = gltf['animations'][0]
    
    # Collect Samplers for each bone
    bone_tracks = {} # { 'hips': { translation: sampler, rotation: sampler } }
    
    for channel in anim['channels']:
        node_idx = channel['target']['node']
        path = channel['target']['path']
        
        # Find which Human Bone uses this node
        target_bone = None
        for hb_name, hb_node in human_bones.items():
            if hb_node == node_idx:
                target_bone = hb_name
                break
        
        if target_bone and target_bone in BONE_ORDER:
            sampler = anim['samplers'][channel['sampler']]
            if target_bone not in bone_tracks: bone_tracks[target_bone] = {}
            bone_tracks[target_bone][path] = {
                'times': get_accessor_data(gltf, sampler['input'], buffers),
                'values': get_accessor_data(gltf, sampler['output'], buffers)
            }

    # Resample at 30 FPS
    fps = 30.0
    # Determine max duration
    max_time = 0
    for b in bone_tracks.values():
        for t in b.values():
            if t['times']: max_time = max(max_time, t['times'][-1])
            
    frame_count = math.ceil(max_time * fps)
    frames = []

    for i in range(frame_count):
        t = i / fps
        frame = {'bones': {}}
        
        for bone_name in BONE_ORDER:
            tracks = bone_tracks.get(bone_name, {})
            
            # Hips Position
            pos = [0,0,0]
            if bone_name == 'hips' and 'translation' in tracks:
                times = tracks['translation']['times']
                values = tracks['translation']['values']
                # Find interpolation interval
                # Simple linear search (can optimize)
                idx = 0
                while idx < len(times)-1 and t > times[idx+1]:
                    idx += 1
                alpha = (t - times[idx]) / (times[idx+1] - times[idx]) if (times[idx+1] != times[idx]) else 0
                alpha = max(0, min(1, alpha))
                pos = v_lerp(values[idx], values[idx+1], alpha)
            
            # Rotation
            rot = [0,0,0,1]
            if 'rotation' in tracks:
                times = tracks['rotation']['times']
                values = tracks['rotation']['values']
                idx = 0
                while idx < len(times)-1 and t > times[idx+1]:
                    idx += 1
                alpha = (t - times[idx]) / (times[idx+1] - times[idx]) if (times[idx+1] != times[idx]) else 0
                alpha = max(0, min(1, alpha))
                rot = q_slerp(values[idx], values[idx+1], alpha)
            
            frame['bones'][bone_name] = {'p': pos, 'r': rot}
            
        frames.append(frame)

    # Pack to Binary
    # Header: FPS (f32), Duration (f32), FrameCount (u32)
    header = struct.pack('<ffI', fps, max_time, frame_count)
    
    # Body
    body_bytes = bytearray()
    for frame in frames:
        for bone_name in BONE_ORDER:
            b_data = frame['bones'][bone_name]
            
            if bone_name == 'hips':
                body_bytes.extend(struct.pack('<3f', *b_data['p']))
            
            body_bytes.extend(struct.pack('<4f', *b_data['r']))
            
    return base64.b64encode(header + body_bytes).decode('utf-8')

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert.py <file.vrma>")
        sys.exit(1)
        
    result = convert_vrma(sys.argv[1])
    if result:
        print(json.dumps({"animationData": result}))
