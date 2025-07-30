from flask import Flask, render_template, request, redirect, jsonify, send_file
import boto3, os, sqlite3, uuid, json
from datetime import datetime, timedelta
from dotenv import load_dotenv
import io
import csv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'your-secret-key-here')

# AWS S3 Setup
s3 = boto3.client(
    's3',
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_KEY")
)
BUCKET = os.getenv("S3_BUCKET_NAME")

# Database Setup
def init_db():
    conn = sqlite3.connect('tasks.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS tasks
                 (id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  description TEXT,
                  priority TEXT DEFAULT 'medium',
                  category TEXT DEFAULT 'general',
                  due_date TEXT,
                  completed BOOLEAN DEFAULT 0,
                  created_at TEXT,
                  file_url TEXT,
                  tags TEXT)''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('tasks.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    conn = get_db_connection()
    tasks = conn.execute('''SELECT * FROM tasks ORDER BY 
                           CASE priority 
                           WHEN 'high' THEN 1 
                           WHEN 'medium' THEN 2 
                           WHEN 'low' THEN 3 
                           END, created_at DESC''').fetchall()
    conn.close()
    
    # Calculate statistics
    total_tasks = len(tasks)
    completed_tasks = len([t for t in tasks if t['completed']])
    pending_tasks = total_tasks - completed_tasks
    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    
    stats = {
        'total': total_tasks,
        'completed': completed_tasks,
        'pending': pending_tasks,
        'completion_rate': round(completion_rate, 1)
    }
    
    return render_template("index.html", tasks=tasks, stats=stats)

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    filter_status = request.args.get('status', 'all')
    filter_priority = request.args.get('priority', 'all')
    filter_category = request.args.get('category', 'all')
    search_query = request.args.get('search', '').lower()
    
    conn = get_db_connection()
    query = "SELECT * FROM tasks WHERE 1=1"
    params = []
    
    if filter_status != 'all':
        query += " AND completed = ?"
        params.append(1 if filter_status == 'completed' else 0)
    
    if filter_priority != 'all':
        query += " AND priority = ?"
        params.append(filter_priority)
        
    if filter_category != 'all':
        query += " AND category = ?"
        params.append(filter_category)
    
    if search_query:
        query += " AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)"
        params.extend([f'%{search_query}%', f'%{search_query}%'])
    
    query += ''' ORDER BY 
                CASE priority 
                WHEN 'high' THEN 1 
                WHEN 'medium' THEN 2 
                WHEN 'low' THEN 3 
                END, created_at DESC'''
    
    tasks = conn.execute(query, params).fetchall()
    conn.close()
    
    return jsonify([dict(task) for task in tasks])

@app.route('/api/tasks', methods=['POST'])
def add_task():
    data = request.get_json()
    task_id = str(uuid.uuid4())
    
    # Handle file upload if present
    file_url = ""
    if 'file' in request.files:
        file = request.files['file']
        if file and file.filename:
            try:
                filename = f"{task_id}_{file.filename}"
                s3.upload_fileobj(file, BUCKET, filename)
                file_url = f"https://{BUCKET}.s3.amazonaws.com/{filename}"
            except Exception as e:
                print(f"File upload error: {e}")
    
    conn = get_db_connection()
    conn.execute('''INSERT INTO tasks 
                   (id, title, description, priority, category, due_date, file_url, tags, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (task_id, data['title'], data.get('description', ''), 
                 data.get('priority', 'medium'), data.get('category', 'general'),
                 data.get('due_date', ''), file_url, 
                 json.dumps(data.get('tags', [])), datetime.now().isoformat()))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'id': task_id})

@app.route('/api/tasks/<task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.get_json()
    
    conn = get_db_connection()
    conn.execute('''UPDATE tasks SET 
                   title=?, description=?, priority=?, category=?, 
                   due_date=?, completed=?, tags=?
                   WHERE id=?''',
                (data['title'], data.get('description', ''), 
                 data.get('priority', 'medium'), data.get('category', 'general'),
                 data.get('due_date', ''), data.get('completed', False),
                 json.dumps(data.get('tags', [])), task_id))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM tasks WHERE id=?', (task_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/stats')
def get_stats():
    conn = get_db_connection()
    tasks = conn.execute('SELECT * FROM tasks').fetchall()
    conn.close()
    
    total_tasks = len(tasks)
    completed_tasks = len([t for t in tasks if t['completed']])
    pending_tasks = total_tasks - completed_tasks
    overdue_tasks = 0
    
    today = datetime.now().date()
    for task in tasks:
        if task['due_date'] and not task['completed']:
            due_date = datetime.fromisoformat(task['due_date']).date()
            if due_date < today:
                overdue_tasks += 1
    
    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    
    return jsonify({
        'total': total_tasks,
        'completed': completed_tasks,
        'pending': pending_tasks,
        'overdue': overdue_tasks,
        'completion_rate': round(completion_rate, 1)
    })

@app.route('/export')
def export_tasks():
    conn = get_db_connection()
    tasks = conn.execute('SELECT * FROM tasks ORDER BY created_at DESC').fetchall()
    conn.close()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Title', 'Description', 'Priority', 'Category', 'Due Date', 'Status', 'Created At'])
    
    for task in tasks:
        writer.writerow([
            task['title'], task['description'], task['priority'], 
            task['category'], task['due_date'], 
            'Completed' if task['completed'] else 'Pending',
            task['created_at']
        ])
    
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode()),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'tasks_export_{datetime.now().strftime("%Y%m%d")}.csv'
    )

if __name__ == "__main__":
    init_db()
    app.run(debug=True)

