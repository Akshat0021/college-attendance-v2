import os
import cv2
import numpy as np
import insightface
import traceback
import json
import base64
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from datetime import datetime
from flask_sock import Sock

# ===============================================================
# INITIALIZATION
# ===============================================================
app = Flask(__name__)
sock = Sock(app) 
CORS(app) 

try:
    face_analysis_model = insightface.app.FaceAnalysis(providers=['CPUExecutionProvider'])
    face_analysis_model.prepare(ctx_id=0, det_size=(640, 640))
    print("✅ InsightFace model loaded successfully.")
except Exception as e:
    print(f"❌ FATAL: Error initializing InsightFace model: {e}")
    exit()

SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co'
SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjE3MDI0NywiZXhwIjoyMDc3NzQ2MjQ3fQ.2CxQFJgZ_880Epv7lB_Z8y4pSMQPhQhM9L7mjLXaOKw'

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    print("✅ Supabase client initialized successfully with service role.")
except Exception as e:
    print(f"❌ FATAL: Could not initialize Supabase client: {e}")
    exit()

# ===============================================================
# HELPER FUNCTIONS
# ===============================================================

def convert_score_to_percentage(score):
    return int(score * 100)

def find_best_match(query_embedding, known_embeddings, known_ids, threshold=0.15):
    if not known_ids or known_embeddings.shape[0] == 0:
        return None, 0.0

    query_norm = np.linalg.norm(query_embedding)
    if query_norm == 0: return None, 0.0
    query_embedding_norm = query_embedding / query_norm

    known_norms = np.linalg.norm(known_embeddings, axis=1, keepdims=True)
    known_norms[known_norms == 0] = 1e-6
    known_embeddings_norm = known_embeddings / known_norms

    similarities = np.dot(known_embeddings_norm, query_embedding_norm.T)

    best_match_index = np.argmax(similarities)
    best_score = similarities[best_match_index]

    if best_score > threshold:
        return known_ids[best_match_index], best_score
    else:
        return None, best_score

def decode_base64_image(base64_string):
    try:
        img_data = base64_string.split(',', 1)[1]
        img_bytes = base64.b64decode(img_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"Error decoding base64 image: {e}")
        return None

# ===============================================================
# REAL-TIME WEBSOCKET ENDPOINT (UPDATED)
# ===============================================================
@sock.route('/ws/start_attendance')
def start_attendance_ws(ws):
    print("--- INFO: WebSocket client connected. Waiting for config. ---")
    
    # Session variables
    known_embeddings_np = np.array([])
    known_student_ids = []
    student_map_simple = {}
    found_student_ids = set()
    
    session_unknown_embeddings = []
    session_unknown_embeddings_np = np.array([])
    total_unknown_faces_found = 0
    UNKNOWN_THRESHOLD = 0.5 

    try:
        config_msg = ws.receive(timeout=10)
        if not config_msg:
            print("--- ERROR: WS Client did not send config in time. ---")
            ws.close(); return
            
        config = json.loads(config_msg)
        group_ids = config.get('group_ids')
        if not group_ids:
            print(f"--- ERROR: WS Client sent invalid config: {config_msg} ---")
            ws.close(); return

        print(f"--- INFO: WS Config received for groups: {group_ids} ---")

        response = supabase.table('student_group_members') \
            .select('students(id, name, roll_number, face_embedding)') \
            .in_('group_id', group_ids) \
            .execute()

        if not response.data:
            ws.send(json.dumps({'type': 'error', 'message': 'No students found for these groups.'}))
            ws.close(); return

        student_map = {}
        for item in response.data:
            student = item.get('students')
            if student and student.get('face_embedding'):
                student_map[student['id']] = student
        
        known_students_data = list(student_map.values())
        if not known_students_data:
            ws.send(json.dumps({'type': 'error', 'message': 'No students in these groups have registered faces.'}))
            ws.close(); return
            
        print(f"--- INFO: Loaded {len(known_students_data)} student(s) with embeddings. Validating... ---")
        
        embeddings_from_db = []
        for s in known_students_data:
            try:
                embedding = json.loads(s['face_embedding'])
                if embedding and isinstance(embedding, list):
                    embeddings_from_db.append(embedding)
                    known_student_ids.append(s['id'])
                    student_map_simple[s['id']] = {'id': s['id'], 'name': s['name'], 'roll_number': s['roll_number']}
                else:
                    print(f"--- WARNING: Skipping student {s['id']} ({s['name']}) due to 'null' face_embedding. ---")
            except (json.JSONDecodeError, TypeError):
                print(f"--- WARNING: Skipping student {s['id']} ({s['name']}) due to invalid/malformed face_embedding. ---")

        if not embeddings_from_db:
            ws.send(json.dumps({'type': 'error', 'message': 'No students in these groups have valid registered faces.'}))
            ws.close(); return

        known_embeddings_np = np.array(embeddings_from_db, dtype=np.float32)
        print(f"--- SUCCESS: {len(known_student_ids)} valid student embeddings loaded into memory. ---")
        
        ws.send(json.dumps({'type': 'status', 'message': 'ready'}))

        # 3. Enter processing loop
        while True:
            base64_frame = ws.receive()
            if not base64_frame: continue

            img = decode_base64_image(base64_frame)
            if img is None: continue
                
            detected_faces = face_analysis_model.get(img)

            # *** NEW: This will be sent as JSON ***
            frame_boxes = [] 

            for face in detected_faces:
                box = face.bbox.astype(int).tolist() # Convert to simple list
                matched_id, score = find_best_match(face.embedding, known_embeddings_np, known_student_ids)
                
                if matched_id:
                    # --- KNOWN STUDENT FOUND ---
                    student_name = student_map_simple[matched_id]['name']
                    confidence = convert_score_to_percentage(score)
                    label = f"{student_name} ({confidence}%)"
                    
                    # Add data for the canvas
                    frame_boxes.append({"label": label, "box": box, "color": "green"})

                    if matched_id not in found_student_ids:
                        found_student_ids.add(matched_id)
                        student_data = student_map_simple.get(matched_id)
                        if student_data:
                            # Send a "match" message to update the list
                            ws.send(json.dumps({
                                'type': 'match',
                                'student': student_data
                            }))
                else:
                    # --- UNKNOWN FACE ---
                    label = "Unknown"
                    # Add data for the canvas
                    frame_boxes.append({"label": label, "box": box, "color": "red"})
                    
                    # De-duplicate unknown faces
                    unknown_match, unknown_score = find_best_match(face.embedding, session_unknown_embeddings_np, list(range(len(session_unknown_embeddings))))
                    
                    if unknown_score < UNKNOWN_THRESHOLD:
                        session_unknown_embeddings.append(face.embedding)
                        session_unknown_embeddings_np = np.array(session_unknown_embeddings, dtype=np.float32)
                        total_unknown_faces_found += 1
                        
                        # Send an "unknown count" update
                        ws.send(json.dumps({'type': 'unknown_update', 'count': total_unknown_faces_found}))

            # *** NEW: Send the JSON box data, NOT an image ***
            ws.send(json.dumps({
                'type': 'frame_data',
                'boxes': frame_boxes
            }))

    except Exception as e:
        if "ConnectionClosed" not in str(e):
            print(f"❌ ERROR in WebSocket: {e}\n{traceback.format_exc()}")
    finally:
        print("--- INFO: WebSocket client disconnected. ---")

# ===============================================================
# API ENDPOINTS (Unchanged)
# ===============================================================
@app.route('/health')
def health_check():
    return jsonify({'status': 'ok', 'message': 'Face API is running.'})

@app.route('/get_embedding', methods=['POST'])
def get_embedding():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    try:
        file = request.files['image'].read()
        npimg = np.frombuffer(file, np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        faces = face_analysis_model.get(img)
        if faces and len(faces) > 0:
            return jsonify({'embedding': faces[0].embedding.tolist()})
        else:
            return jsonify({'error': 'No face detected'}), 400
    except Exception as e:
        print(f"❌ ERROR in /get_embedding: {e}\n{traceback.format_exc()}")
        return jsonify({'error': 'Server processing error'}), 500

@app.route('/process_class_image', methods=['POST'])
def process_class_image():
    # This old endpoint is still here, but your new UI won't use it.
    print("--- INFO: /process_class_image (single scan) endpoint hit. ---")
    if 'image' not in request.files or 'group_ids' not in request.form:
        return jsonify({'error': 'Missing image or group_ids'}), 400
    try:
        group_ids = json.loads(request.form['group_ids'])
        if not isinstance(group_ids, list) or len(group_ids) == 0:
            return jsonify({'error': 'group_ids must be a non-empty array.'}), 400
        response = supabase.table('student_group_members') \
            .select('students(id, name, roll_number, face_embedding)') \
            .in_('group_id', group_ids) \
            .execute()
        if not response.data:
            return jsonify({'error': "No students found in these groups."}), 404
        student_map = {}
        for item in response.data:
            student = item.get('students')
            if student and student.get('face_embedding'):
                student_map[student['id']] = student
        known_students_data = list(student_map.values())
        if not known_students_data:
            return jsonify({'error': "No students in these groups have registered faces."}), 404
        student_map_simple = {s['id']: {'name': s['name'], 'roll_number': s['roll_number']} for s in known_students_data}
        known_student_ids = [s['id'] for s in known_students_data]
        embeddings_from_db = []
        valid_student_ids = []
        valid_student_map = {}
        for s in known_students_data:
            try:
                embedding = json.loads(s['face_embedding'])
                if embedding and isinstance(embedding, list):
                    embeddings_from_db.append(embedding)
                    valid_student_ids.append(s['id'])
                    valid_student_map[s['id']] = student_map_simple[s['id']]
            except (json.JSONDecodeError, TypeError):
                continue
        if not embeddings_from_db:
             return jsonify({'error': "No valid student embeddings found."}), 404
        known_embeddings = np.array(embeddings_from_db, dtype=np.float32)
        file = request.files['image'].read()
        npimg = np.frombuffer(file, np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        detected_faces = face_analysis_model.get(img)
        present_student_ids_with_scores = {}
        unknown_face_embeddings = []
        for face in detected_faces:
            box = face.bbox.astype(int)
            matched_id, score = find_best_match(face.embedding, known_embeddings, valid_student_ids)
            if matched_id:
                if matched_id not in present_student_ids_with_scores or score > present_student_ids_with_scores[matched_id]:
                    present_student_ids_with_scores[matched_id] = score
                student_name = valid_student_map[matched_id]['name']
                confidence = convert_score_to_percentage(score)
                label = f"{student_name.split(' ')[0]} ({confidence}%)"
                color = (0, 255, 0)
                cv2.rectangle(img, (box[0], box[1]), (box[2], box[3]), color, 2)
                cv2.putText(img, label, (box[0], box[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            else:
                unknown_face_embeddings.append(face.embedding.tolist())
                color = (0, 0, 255)
                cv2.rectangle(img, (box[0], box[1]), (box[2], box[3]), color, 2)
                cv2.putText(img, "Unknown", (box[0], box[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        present_ids = list(present_student_ids_with_scores.keys())
        all_student_ids_in_groups = set(valid_student_ids)
        present_student_ids_set = set(present_ids)
        absent_student_ids_for_display = all_student_ids_in_groups - present_student_ids_set
        _, buffer = cv2.imencode('.jpg', img)
        img_str = base64.b64encode(buffer).decode('utf-8')
        processed_image_data_url = f"data:image/jpeg;base64,{img_str}"
        present_students = [{'id': sid, 'name': valid_student_map[sid]['name'], 'roll_number': valid_student_map[sid]['roll_number'], 'confidence': convert_score_to_percentage(score)} for sid, score in present_student_ids_with_scores.items()]
        absent_students = [{'id': sid, 'name': valid_student_map[sid]['name'], 'roll_number': valid_student_map[sid]['roll_number']} for sid in absent_student_ids_for_display]
        return jsonify({
            'present_students': sorted(present_students, key=lambda x: x.get('name', '')),
            'absent_students': sorted(absent_students, key=lambda x: x.get('name', '')),
            'unknown_faces': len(detected_faces) - len(present_ids),
            'processed_image_url': processed_image_data_url,
            'unknown_face_embeddings': unknown_face_embeddings
        })
    except Exception as e:
        print(f"❌ ERROR in /process_class_image: {e}\n{traceback.format_exc()}")
        return jsonify({'error': 'Internal server error.'}), 500

# ===============================================================
# RUN THE APP
# ===============================================================
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)