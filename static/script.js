// Global variables
let tasks = [];
let currentEditingTaskId = null;
let isLoading = false;

// DOM Elements
const taskModal = document.getElementById('task-modal');
const taskForm = document.getElementById('task-form');
const tasksGrid = document.getElementById('tasks-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const statusFilter = document.getElementById('status-filter');
const priorityFilter = document.getElementById('priority-filter');
const categoryFilter = document.getElementById('category-filter');
const fileUploadArea = document.getElementById('file-upload-area');
const taskFileInput = document.getElementById('task-file');
const loading = document.getElementById('loading');

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadTasks();
    setupEventListeners();
    updateStats();
});

// Event Listeners
function setupEventListeners() {
    // Search and filters
    searchInput.addEventListener('input', debounce(filterTasks, 300));
    statusFilter.addEventListener('change', filterTasks);
    priorityFilter.addEventListener('change', filterTasks);
    categoryFilter.addEventListener('change', filterTasks);
    
    // Task form
    taskForm.addEventListener('submit', handleTaskSubmit);
    
    // File upload
    fileUploadArea.addEventListener('click', () => taskFileInput.click());
    fileUploadArea.addEventListener('dragover', handleDragOver);
    fileUploadArea.addEventListener('dragleave', handleDragLeave);
    fileUploadArea.addEventListener('drop', handleFileDrop);
    taskFileInput.addEventListener('change', handleFileSelect);
    
    // Modal
    taskModal.addEventListener('click', (e) => {
        if (e.target === taskModal) closeTaskModal();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTaskModal();
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            showAddTaskModal();
        }
    });
}

// API Functions
async function apiCall(url, options = {}) {
    showLoading();
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        showToast('Operation failed. Please try again.', 'error');
        throw error;
    } finally {
        hideLoading();
    }
}

async function loadTasks() {
    try {
        const params = new URLSearchParams({
            status: statusFilter.value,
            priority: priorityFilter.value,
            category: categoryFilter.value,
            search: searchInput.value
        });
        
        tasks = await apiCall(`/api/tasks?${params}`);
        renderTasks();
        updateStats();
    } catch (error) {
        console.error('Failed to load tasks:', error);
    }
}

async function createTask(taskData) {
    try {
        const result = await apiCall('/api/tasks', {
            method: 'POST',
            body: JSON.stringify(taskData)
        });
        
        if (result.success) {
            showToast('Task created successfully!', 'success');
            loadTasks();
            closeTaskModal();
        }
    } catch (error) {
        console.error('Failed to create task:', error);
    }
}

async function updateTask(taskId, taskData) {
    try {
        const result = await apiCall(`/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify(taskData)
        });
        
        if (result.success) {
            showToast('Task updated successfully!', 'success');
            loadTasks();
            closeTaskModal();
        }
    } catch (error) {
        console.error('Failed to update task:', error);
    }
}

async function deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
        const result = await apiCall(`/api/tasks/${taskId}`, {
            method: 'DELETE'
        });
        
        if (result.success) {
            showToast('Task deleted successfully!', 'success');
            loadTasks();
        }
    } catch (error) {
        console.error('Failed to delete task:', error);
    }
}

async function toggleTaskCompletion(taskId, completed) {
    try {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        
        task.completed = completed;
        const result = await apiCall(`/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify(task)
        });
        
        if (result.success) {
            showToast(completed ? 'Task completed!' : 'Task marked as pending', 'success');
            loadTasks();
        }
    } catch (error) {
        console.error('Failed to toggle task completion:', error);
    }
}

async function updateStats() {
    try {
        const stats = await apiCall('/api/stats');
        
        document.getElementById('total-tasks').textContent = stats.total;
        document.getElementById('completed-tasks').textContent = stats.completed;
        document.getElementById('pending-tasks').textContent = stats.pending;
        document.getElementById('completion-rate').textContent = stats.completion_rate + '%';
    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

// UI Functions
function renderTasks() {
    if (tasks.length === 0) {
        tasksGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    tasksGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    tasksGrid.innerHTML = tasks.map(task => createTaskCard(task)).join('');
}

function createTaskCard(task) {
    const dueDate = task.due_date ? new Date(task.due_date) : null;
    const isOverdue = dueDate && dueDate < new Date() && !task.completed;
    const tags = task.tags ? JSON.parse(task.tags) : [];
    
    return `
        <div class="task-card ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
            <div class="task-priority ${task.priority}"></div>
            
            <div class="task-header">
                <div>
                    <h3 class="task-title">${escapeHtml(task.title)}</h3>
                    ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
                </div>
                <div class="task-actions">
                    <button class="task-action btn-success" onclick="editTask('${task.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="task-action btn-danger" onclick="deleteTask('${task.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            <div class="task-meta">
                <span class="task-badge priority ${task.priority}">
                    <i class="fas fa-flag"></i>
                    ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </span>
                <span class="task-badge category">
                    <i class="fas fa-folder"></i>
                    ${task.category.charAt(0).toUpperCase() + task.category.slice(1)}
                </span>
                ${dueDate ? `
                    <span class="task-badge due-date ${isOverdue ? 'overdue' : ''}">
                        <i class="fas fa-calendar"></i>
                        ${formatDate(dueDate)}
                    </span>
                ` : ''}
            </div>
            
            ${tags.length > 0 ? `
                <div class="task-tags">
                    ${tags.map(tag => `<span class="task-tag">#${tag.trim()}</span>`).join('')}
                </div>
            ` : ''}
            
            ${task.file_url ? `
                <div class="task-file">
                    <a href="${task.file_url}" target="_blank">
                        <i class="fas fa-paperclip"></i>
                        View Attachment
                    </a>
                </div>
            ` : ''}
            
            <div class="task-footer">
                <label class="task-checkbox">
                    <input type="checkbox" ${task.completed ? 'checked' : ''} 
                           onchange="toggleTaskCompletion('${task.id}', this.checked)">
                    <span>${task.completed ? 'Completed' : 'Mark as complete'}</span>
                </label>
                <small style="color: #718096;">
                    Created: ${formatDate(new Date(task.created_at))}
                </small>
            </div>
        </div>
    `;
}

// Modal Functions
function showAddTaskModal() {
    currentEditingTaskId = null;
    document.getElementById('modal-title').textContent = 'Add New Task';
    resetTaskForm();
    taskModal.style.display = 'block';
    document.getElementById('task-title').focus();
}

function editTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    currentEditingTaskId = taskId;
    document.getElementById('modal-title').textContent = 'Edit Task';
    
    // Populate form
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-description').value = task.description || '';
    document.getElementById('task-priority').value = task.priority;
    document.getElementById('task-category').value = task.category;
    document.getElementById('task-due-date').value = task.due_date ? 
        new Date(task.due_date).toISOString().slice(0, 16) : '';
    
    const tags = task.tags ? JSON.parse(task.tags) : [];
    document.getElementById('task-tags').value = tags.join(', ');
    
    taskModal.style.display = 'block';
    document.getElementById('task-title').focus();
}

function closeTaskModal() {
    taskModal.style.display = 'none';
    resetTaskForm();
    currentEditingTaskId = null;
}

function resetTaskForm() {
    taskForm.reset();
    document.getElementById('task-priority').value = 'medium';
    document.getElementById('task-category').value = 'general';
    fileUploadArea.classList.remove('dragover');
}

// Form Handlers
async function handleTaskSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData();
    const taskData = {
        title: document.getElementById('task-title').value.trim(),
        description: document.getElementById('task-description').value.trim(),
        priority: document.getElementById('task-priority').value,
        category: document.getElementById('task-category').value,
        due_date: document.getElementById('task-due-date').value,
        tags: document.getElementById('task-tags').value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0)
    };
    
    if (!taskData.title) {
        showToast('Please enter a task title', 'error');
        return;
    }
    
    if (currentEditingTaskId) {
        await updateTask(currentEditingTaskId, taskData);
    } else {
        await createTask(taskData);
    }
}

// File Upload Handlers
function handleDragOver(e) {
    e.preventDefault();
    fileUploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
}

function handleFileDrop(e) {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        taskFileInput.files = files;
        updateFileUploadDisplay(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        updateFileUploadDisplay(file);
    }
}

function updateFileUploadDisplay(file) {
    fileUploadArea.innerHTML = `
        <i class="fas fa-file"></i>
        <p>Selected: ${file.name}</p>
        <small>Size: ${formatFileSize(file.size)}</small>
    `;
}

// Filter Functions
async function filterTasks() {
    await loadTasks();
}

// Utility Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function formatDate(date) {
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days`;
    if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
    
    return date.toLocaleDateString();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    if (!isLoading) {
        isLoading = true;
        loading.style.display = 'flex';
    }
}

function hideLoading() {
    isLoading = false;
    loading.style.display = 'none';
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="${icons[type]}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Export Functions
function exportTasks() {
    window.open('/export', '_blank');
}

// Add CSS for slide out animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOutRight {
        from { 
            opacity: 1;
            transform: translateX(0);
        }
        to { 
            opacity: 0;
            transform: translateX(100%);
        }
    }
`;
document.head.appendChild(style);
