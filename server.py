import os
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import mlx_whisper
import threading

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'m4a','mp3','wav'}
WHISPER_MODEL_NAME = "mlx-community/whisper-large-v3-turbo"

print('loading whisper model', WHISPER_MODEL_NAME)

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app = Flask(__name__)
CORS(app)  # CORSを有効にしてReactからのリクエストを許可
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

lock = threading.Lock()

@app.route('/api/transcribe', methods=['POST'])
def transcribe():
   time_sta = time.perf_counter()
   print('start transcribe ' + str(time_sta))
   
   if 'file' not in request.files:
       return jsonify({'error': 'No file provided'}), 400
       
   file = request.files['file']
   if file.filename == '':
       return jsonify({'error': 'No file selected'}), 400
       
   if not file.filename:
       return jsonify({'error': 'Invalid filename'}), 400
       
   ext = file.filename.rsplit('.', 1)[1].lower()
   if ext and ext in ALLOWED_EXTENSIONS:
       filename = str(int(time.time())) + '.' + ext
       saved_filename = os.path.join(app.config['UPLOAD_FOLDER'], filename)
       file.save(saved_filename)
       
       with lock:
           result = mlx_whisper.transcribe(saved_filename, path_or_hf_repo=WHISPER_MODEL_NAME, language='ja', fp16=True)
       
       # 結果をJSON形式で返す
       return jsonify(result), 200

   return jsonify({'error': 'Invalid file format'}), 400

if __name__ == '__main__':
    app.run(host='localhost', port=9000, debug=True)
