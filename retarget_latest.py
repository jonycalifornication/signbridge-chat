import copy
import time
import bpy
import asyncio
import sys
import math
import os
from mathutils import Vector, Matrix
from contextlib import suppress


# --- UTILS (Без изменений) ---

def ui_refresh_properties():
    for windowManager in bpy.data.window_managers:
        for window in windowManager.windows:
            for area in window.screen.areas:
                if area.type == 'PROPERTIES':
                    area.tag_redraw()


def set_active(obj):
    if not obj: return
    obj.select_set(True)
    obj.hide_set(False)
    bpy.context.view_layer.objects.active = obj


def mat3_to_vec_roll(mat):
    vecmat = vec_roll_to_mat3(mat.col[1], 0)
    vecmatinv = vecmat.inverted()
    rollmat = vecmatinv @ mat
    roll = math.atan2(rollmat[0][2], rollmat[2][2])
    return roll


def vec_roll_to_mat3(vec, roll):
    target = Vector((0, 0.1, 0))
    nor = vec.normalized()
    axis = target.cross(nor)
    if axis.dot(axis) > 0.0000000001:
        axis.normalize()
        theta = target.angle(nor)
        bMatrix = Matrix.Rotation(theta, 3, axis)
    else:
        updown = 1 if target.dot(nor) > 0 else -1
        bMatrix = Matrix.Scale(updown, 3)
        bMatrix[2][2] = 1.0

    rMatrix = Matrix.Rotation(roll, 3, nor)
    mat = rMatrix @ bMatrix
    return mat


RETARGET_ID = '_RSL_RETARGET'

# BONE_MAP (Без изменений)
BONE_MAP = {
    "Hips": "CC_Base_Hip",
    "Spine": "CC_Base_Waist",
    "Spine1": "CC_Base_Spine01",
    "Spine2": "CC_Base_Spine02",
    "Neck": "CC_Base_NeckTwist01",
    "Head": "CC_Base_Head",
    "LeftShoulder": "CC_Base_L_Clavicle",
    "LeftArm": "CC_Base_L_Upperarm",
    "LeftForeArm": "CC_Base_L_Forearm",
    "LeftHand": "CC_Base_L_Hand",
    "RightShoulder": "CC_Base_R_Clavicle",
    "RightArm": "CC_Base_R_Upperarm",
    "RightForeArm": "CC_Base_R_Forearm",
    "RightHand": "CC_Base_R_Hand",
    "LeftHandThumb1": "CC_Base_L_Thumb1",
    "LeftHandThumb2": "CC_Base_L_Thumb2",
    "LeftHandThumb3": "CC_Base_L_Thumb3",
    "LeftHandIndex1": "CC_Base_L_Index1",
    "LeftHandIndex2": "CC_Base_L_Index2",
    "LeftHandIndex3": "CC_Base_L_Index3",
    "LeftHandMiddle1": "CC_Base_L_Mid1",
    "LeftHandMiddle2": "CC_Base_L_Mid2",
    "LeftHandMiddle3": "CC_Base_L_Mid3",
    "LeftHandRing1": "CC_Base_L_Ring1",
    "LeftHandRing2": "CC_Base_L_Ring2",
    "LeftHandRing3": "CC_Base_L_Ring3",
    "LeftHandPinky1": "CC_Base_L_Pinky1",
    "LeftHandPinky2": "CC_Base_L_Pinky2",
    "LeftHandPinky3": "CC_Base_L_Pinky3",
    "RightHandThumb1": "CC_Base_R_Thumb1",
    "RightHandThumb2": "CC_Base_R_Thumb2",
    "RightHandThumb3": "CC_Base_R_Thumb3",
    "RightHandIndex1": "CC_Base_R_Index1",
    "RightHandIndex2": "CC_Base_R_Index2",
    "RightHandIndex3": "CC_Base_R_Index3",
    "RightHandMiddle1": "CC_Base_R_Mid1",
    "RightHandMiddle2": "CC_Base_R_Mid2",
    "RightHandMiddle3": "CC_Base_R_Mid3",
    "RightHandRing1": "CC_Base_R_Ring1",
    "RightHandRing2": "CC_Base_R_Ring2",
    "RightHandRing3": "CC_Base_R_Ring3",
    "RightHandPinky1": "CC_Base_R_Pinky1",
    "RightHandPinky2": "CC_Base_R_Pinky2",
    "RightHandPinky3": "CC_Base_R_Pinky3",
    "LeftUpLeg": "CC_Base_L_Thigh",
    "LeftLeg": "CC_Base_L_Calf",
    "LeftFoot": "CC_Base_L_Foot",
    "LeftToeBase": "CC_Base_L_ToeBase",
    "RightUpLeg": "CC_Base_R_Thigh",
    "RightLeg": "CC_Base_R_Calf",
    "RightFoot": "CC_Base_R_Foot",
    "RightToeBase": "CC_Base_R_ToeBase",
}


def clear_nla_and_actions(armature):
    """Удаляет все NLA-треки и отвязывает текущий экшен от арматуры."""
    if not armature.animation_data:
        return

    # 1. Удаляем все NLA-треки
    tracks = armature.animation_data.nla_tracks
    for track in list(tracks):
        tracks.remove(track)

    # 2. Обнуляем текущий активный экшен
    armature.animation_data.action = None
    print(f"Очистка NLA и экшенов для {armature.name} завершена.")


def purge_unused_actions():
    """Полностью удаляет экшены из памяти Blender, у которых 0 пользователей."""
    for action in list(bpy.data.actions):
        if action.users == 0:
            bpy.data.actions.remove(action)


# --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ИМПОРТА ---
def import_fbx_safe(filepath):
    """
    Импортирует FBX и возвращает:
    1. Объект арматуры (если найден).
    2. СПИСОК всех объектов, которые были созданы этим импортом.
    """
    if not os.path.exists(filepath):
        print(f"Файл не найден: {filepath}")
        return None, []

    # 1. Запоминаем текущие объекты в сцене
    old_objects = set(bpy.context.scene.objects)

    # 2. Снимаем выделение (на всякий случай)
    bpy.ops.object.select_all(action='DESELECT')

    # 3. Импорт
    print(f"Импорт файла: {filepath}")
    bpy.ops.import_scene.fbx(filepath=filepath, anim_offset=0)

    # 4. Вычисляем новые объекты (Текущие - Старые)
    current_objects = set(bpy.context.scene.objects)
    new_objects = list(current_objects - old_objects)

    imported_armature = None
    for obj in new_objects:
        if obj.type == 'ARMATURE':
            imported_armature = obj
            break

    if imported_armature:
        print(f"Найдена арматура: {imported_armature.name}")
    else:
        print("ПРЕДУПРЕЖДЕНИЕ: В FBX файле не найдена арматура!")

    return imported_armature, new_objects


# --- ФУНКЦИИ РЕТАРГЕТА (Без изменений) ---

def retarget_animation_headless(source_name, target_name, use_pose='REST', auto_scale=True):
    start_time = time.time()
    result_action = None

    armature_source = bpy.data.objects.get(source_name)
    armature_target = bpy.data.objects.get(target_name)

    if not armature_source or not armature_target:
        print('ОШИБКА: Исходный или целевой скелет не найден.')
        return None

    if armature_source.name == armature_target.name:
        return None

    retarget_bone_list = []
    for source_bone, target_bone in BONE_MAP.items():
        if armature_source.data.bones.get(source_bone) and armature_target.data.bones.get(target_bone):
            retarget_bone_list.append({'source': source_bone, 'target': target_bone})

    if not retarget_bone_list:
        print('ОШИБКА: Нет пар костей.')
        return None

    root_bones = find_root_bones(armature_target, retarget_bone_list)

    armature_source_copy = None
    source_scale = None
    saved_rot, saved_loc, saved_scale = None, None, None
    armature_source_original = armature_source

    try:
        set_active(armature_target)
        bpy.ops.object.mode_set(mode='OBJECT')
        set_active(armature_source)
        bpy.ops.object.mode_set(mode='OBJECT')

        if use_pose == 'REST':
            get_and_reset_pose_rotations(armature_source)
            get_and_reset_pose_rotations(armature_target)

        if auto_scale:
            source_scale = copy.deepcopy(armature_source.scale)
            scale_armature(armature_source, armature_target, root_bones, retarget_bone_list)

        armature_source_copy = copy_rest_pose(armature_source)

        saved_rot = armature_target.rotation_quaternion.copy()
        saved_loc = armature_target.location.copy()
        saved_scale = armature_target.scale.copy()

        set_active(armature_target)
        armature_target.location = (0, 0, 0)
        armature_target.rotation_quaternion = (1, 0, 0, 0)
        armature_target.scale = (1, 1, 1)

        bpy.ops.object.mode_set(mode='EDIT')
        bone_transforms = {}
        for bone in armature_target.data.edit_bones:
            bone.select = False
            bone_transforms[bone.name] = armature_source_copy.matrix_world.inverted() @ bone.head.copy(), \
                                         armature_source_copy.matrix_world.inverted() @ bone.tail.copy(), \
                mat3_to_vec_roll(armature_source_copy.matrix_world.inverted().to_3x3() @ bone.matrix.to_3x3())
        bpy.ops.object.mode_set(mode='OBJECT')

        set_active(armature_source_copy)
        bpy.ops.object.mode_set(mode='EDIT')
        for item in retarget_bone_list:
            bone_source = armature_source_copy.data.edit_bones.get(item['source'])
            if not bone_source: continue
            bone_new = armature_source_copy.data.edit_bones.new(item['target'] + RETARGET_ID)
            bone_new.head, bone_new.tail, bone_new.roll = bone_transforms[item['target']]
            bone_new.parent = bone_source
        bpy.ops.object.mode_set(mode='OBJECT')

        for item in retarget_bone_list:
            bone_target = armature_target.pose.bones.get(item['target'])
            if not bone_target: continue

            const_rot = bone_target.constraints.new('COPY_ROTATION')
            const_rot.name = RETARGET_ID + "_ROT"
            const_rot.target = armature_source_copy
            const_rot.subtarget = item['target'] + RETARGET_ID

            if bone_target.name in root_bones:
                const_loc = bone_target.constraints.new('COPY_LOCATION')
                const_loc.name = RETARGET_ID + "_LOC"
                const_loc.target = armature_source_copy
                const_loc.subtarget = item['source']

            armature_target.data.bones.get(item['target']).select = True

        bake_animation(armature_source_copy, armature_target)

        if armature_target.animation_data and armature_target.animation_data.action:
            result_action = armature_target.animation_data.action
            result_action.name = f"Retarget_{source_name}"
            result_action.use_fake_user = False

    except Exception as e:
        print(f"!!! ОШИБКА РЕТАРГЕТА ({source_name}): {e}")
        import traceback
        traceback.print_exc()

    finally:
        if armature_source_copy:
            remove_temp_armature(armature_source_copy)

        if bpy.context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')

        if armature_target:
            for bone in armature_target.pose.bones:
                for constraint in bone.constraints:
                    if RETARGET_ID in constraint.name:
                        bone.constraints.remove(constraint)

            set_active(armature_target)
            if saved_rot and saved_loc:
                armature_target.rotation_quaternion = saved_rot
                armature_target.location = saved_loc
                armature_target.scale = saved_scale

            for bone in armature_target.data.bones:
                bone.select = False

        if source_scale and armature_source_original:
            armature_source_original.scale = source_scale

        bpy.ops.object.select_all(action='DESELECT')

        return result_action


def find_root_bones(armature_target, retarget_bone_list):
    root_bones = [b for b in armature_target.pose.bones if not b.parent]
    root_bones_animated = []
    target_bones = [item['target'] for item in retarget_bone_list]
    queue = list(root_bones)
    visited = set()
    while queue:
        bone = queue.pop(0)
        if bone in visited: continue
        visited.add(bone)
        if bone.name in target_bones:
            root_bones_animated.append(bone.name)
        else:
            for child in bone.children:
                queue.append(child)
    return root_bones_animated


def get_and_reset_pose_rotations(armature):
    set_active(armature)
    bpy.ops.object.mode_set(mode='POSE')
    for bone in armature.pose.bones:
        if bone.rotation_mode == 'QUATERNION':
            bone.rotation_quaternion = (1, 0, 0, 0)
        else:
            bone.rotation_euler = (0, 0, 0)
    bpy.ops.object.mode_set(mode='OBJECT')


def scale_armature(armature_source, armature_target, root_bones, retarget_bone_list):
    source_min, source_min_root = None, None
    target_min, target_min_root = None, None
    for item in retarget_bone_list:
        bone_source = armature_source.pose.bones.get(item['source'])
        bone_target = armature_target.pose.bones.get(item['target'])
        if not bone_source or not bone_target: continue
        bone_source_z = (armature_source.matrix_world @ bone_source.head)[2]
        bone_target_z = (armature_target.matrix_world @ bone_target.head)[2]
        if item['target'] in root_bones:
            if source_min_root is None or source_min_root > bone_source_z: source_min_root = bone_source_z
            if target_min_root is None or target_min_root > bone_target_z: target_min_root = bone_target_z
        if source_min is None or source_min > bone_source_z: source_min = bone_source_z
        if target_min is None or target_min > bone_target_z: target_min = bone_target_z

    if source_min is None or source_min_root is None or target_min is None or target_min_root is None: return
    source_height = source_min_root - source_min
    target_height = target_min_root - target_min
    if not source_height or not target_height: return
    scale_factor = target_height / source_height
    armature_source.scale *= scale_factor


def read_anim_start_end(armature):
    frame_start, frame_end = None, None
    if not armature.animation_data or not armature.animation_data.action:
        return 0, 1
    for fcurve in armature.animation_data.action.fcurves:
        if not fcurve.keyframe_points: continue
        start = fcurve.keyframe_points[0].co.x
        end = fcurve.keyframe_points[-1].co.x
        if frame_start is None or start < frame_start: frame_start = start
        if frame_end is None or end > frame_end: frame_end = end
    return frame_start or 0, frame_end or 1


def copy_rest_pose(armature_source):
    bpy.context.scene.tool_settings.use_keyframe_insert_auto = False
    bpy.ops.object.select_all(action='DESELECT')
    set_active(armature_source)
    bpy.ops.object.duplicate(linked=False)
    source_armature_copy = bpy.context.object
    source_armature_copy.data = source_armature_copy.data.copy()
    source_armature_copy.name = armature_source.name + "_copy"
    try:
        source_armature_copy.matrix_world = armature_source.matrix_world.copy()
    except:
        pass

    set_active(source_armature_copy)
    bpy.ops.object.mode_set(mode='POSE')
    action_tmp = None
    if source_armature_copy.animation_data:
        action_tmp = source_armature_copy.animation_data.action
        source_armature_copy.animation_data.action = None
    bpy.ops.pose.armature_apply(selected=False)
    if action_tmp:
        if not source_armature_copy.animation_data:
            source_armature_copy.animation_data_create()
        source_armature_copy.animation_data.action = action_tmp

    for bone in source_armature_copy.pose.bones:
        con = bone.constraints.new('COPY_TRANSFORMS')
        con.name = bone.name + "_COPYT"
        con.target = armature_source
        con.subtarget = bone.name
    bpy.ops.object.mode_set(mode='OBJECT')
    return source_armature_copy


def remove_temp_armature(obj):
    if not obj: return
    armature_data = obj.data
    obj_name = obj.name
    try:
        bpy.data.objects.remove(obj, do_unlink=True)
    except Exception:
        if obj_name in bpy.data.objects: return
    if armature_data and armature_data.users == 0:
        try:
            bpy.data.armatures.remove(armature_data)
        except Exception:
            pass


def bake_animation(armature_source, armature_target):
    frame_start, frame_end = read_anim_start_end(armature_source)
    frame_start, frame_end = int(frame_start), int(frame_end)
    set_active(armature_target)

    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.nla.bake(
        frame_start=frame_start,
        frame_end=frame_end,
        visual_keying=True,
        clear_constraints=True,
        only_selected=True,
        use_current_action=False,
        bake_types={'POSE'}
    )
    bpy.ops.object.mode_set(mode='OBJECT')

    action = armature_target.animation_data.action
    if not action: return
    for fcurve in action.fcurves:
        if len(fcurve.keyframe_points) <= 2: continue
        kp_to_delete = []
        kp_pre_pre = fcurve.keyframe_points[0]
        kp_pre = fcurve.keyframe_points[1]
        for kp in fcurve.keyframe_points[2:]:
            if round(kp_pre_pre.co.y, 5) == round(kp_pre.co.y, 5) == round(kp.co.y, 5):
                kp_to_delete.append(kp_pre)
            kp_pre_pre = kp_pre
            kp_pre = kp
        for kp in reversed(kp_to_delete):
            try:
                fcurve.keyframe_points.remove(kp)
            except RuntimeError:
                pass


# --- ИСПРАВЛЕННАЯ ФУНКЦИЯ STITCHING ---

def process_multiple_fbx_and_stitch(fbx_files_list, target_name, final_bake=True):
    armature_target = bpy.data.objects.get(target_name)
    if not armature_target:
        print(f"ОШИБКА: Целевой скелет '{target_name}' не найден.")
        return

    # --- НОВЫЙ БЛОК ОЧИСТКИ ---
    if armature_target.animation_data:
        clear_nla_and_actions(armature_target)
    else:
        armature_target.animation_data_create()

    # Опционально: чистим библиотеку данных от старых неиспользуемых анимаций
    purge_unused_actions()

    track_name = "Retarget_Stitch_Track"
    stitch_track = armature_target.animation_data.nla_tracks.new()
    stitch_track.name = track_name

    current_cursor = 0

    for fpath in fbx_files_list:
        print(f"\n>>> Обработка: {os.path.basename(fpath)}")

        # 1. Используем БЕЗОПАСНЫЙ импорт
        # imported_objects - список всего, что пришло из файла
        source_armature, imported_objects = import_fbx_safe(fpath)

        if not source_armature:
            print("Пропуск файла из-за ошибки импорта (арматура не найдена).")
            # Удаляем мусор, если он все-таки импортировался
            for obj in imported_objects:
                try:
                    bpy.data.objects.remove(obj, do_unlink=True)
                except:
                    pass
            continue

        # 2. Ретаргет
        action = retarget_animation_headless(source_armature.name, target_name, use_pose='REST', auto_scale=True)

        if action:
            print(f"Ретаргет успешен. Длина анимации: {action.frame_range}")

            start_frame = int(action.frame_range[0])
            end_frame = int(action.frame_range[1])
            duration = end_frame - start_frame

            strip = stitch_track.strips.new(action.name, current_cursor, action)
            current_cursor += duration

            armature_target.animation_data.action = None
        else:
            print("Не удалось создать анимацию.")

        # 3. БЕЗОПАСНОЕ УДАЛЕНИЕ
        # Удаляем только те объекты, которые вернула функция import_fbx_safe
        print("Удаление временных объектов FBX...")
        bpy.ops.object.select_all(action='DESELECT')

        for obj in imported_objects:
            # Двойная проверка: никогда не удалять целевой скелет
            if obj.name == target_name:
                print("!!! ВНИМАНИЕ: Попытка удаления целевого скелета предотвращена.")
                continue

            try:
                # Прямое удаление через data API (игнорирует иерархию сцены)
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception as e:
                print(f"Не удалось удалить {obj.name}: {e}")

    # --- ФИНАЛЬНОЕ ЗАПЕКАНИЕ ---
    if final_bake and len(stitch_track.strips) > 0:
        print("\n>>> Финальное запекание склеенной анимации в один Action...")

        bpy.context.scene.frame_start = 0
        bpy.context.scene.frame_end = int(current_cursor)

        set_active(armature_target)

        for strip in stitch_track.strips:
            strip.select = True

        bpy.ops.object.mode_set(mode='OBJECT')

        # Используем visual_keying=True, но только для POSE, чтобы не ломать меш
        bpy.ops.nla.bake(
            frame_start=0,
            frame_end=int(current_cursor),
            only_selected=False,
            visual_keying=True,
            clear_constraints=False,
            bake_types={'POSE'}
            # <-- ВАЖНО: Только POSE, чтобы не запекать трансформации объекта (которые могут унести меш)
        )
        print("Готово! Все анимации склеены.")


def run_scripting_test():
    print("\n" + "=" * 50)
    print("--- ЗАПУСК MULTI-FBX STITCHING TEST (SAFE MODE) ---")

    # --- !! НАСТРОЙКИ !! ---
    TARGET_NAME = "Armature"

    FBX_FILES = [
        "/Users/damir/fbx_storage/aga_hik.fbx",
    ]
    # -----------------------

    if not bpy.data.objects.get(TARGET_NAME):
        print(f"ОШИБКА: Не найден объект-цель '{TARGET_NAME}'")
        return

    process_multiple_fbx_and_stitch(FBX_FILES, TARGET_NAME, final_bake=True)


if __name__ == "__main__":
    run_scripting_test()

