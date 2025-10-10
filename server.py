import os
import time
from flask import Flask, request, render_template
import mlx_whisper
import threading

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'m4a','mp3','wav'}
CSS_TEMPLATE_PATH = 'static/index.css'
WHISPER_MODEL_NAME = "mlx-community/whisper-large-v3-mlx"

with open(CSS_TEMPLATE_PATH) as f:
   CSS_TEMPLATE = f.read()

print('loading whisper model', WHISPER_MODEL_NAME)

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app = Flask(__name__, static_url_path='/')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

lock = threading.Lock()

@app.route('/')
def index():
   return render_template('index.html')

@app.route('/api/transcribe', methods=['POST'])
def transcribe():
   time_sta = time.perf_counter()
   print('start transcribe ' + str(time_sta))
   file = request.files['file']
   ext = file.filename.rsplit('.', 1)[1].lower()
   if ext and ext in ALLOWED_EXTENSIONS:
       filename = str(int(time.time())) + '.' + ext
       saved_filename = os.path.join(app.config['UPLOAD_FOLDER'], filename)
       file.save(saved_filename)
       lock.acquire()
       result = mlx_whisper.transcribe(saved_filename, path_or_hf_repo=WHISPER_MODEL_NAME)
       lock.release()
       return result, 200

   result={'error':'something wrong'}
   print(result)
   return result, 400

app.run(host='localhost', port=9000)
