// Rerun Job
// app.js - Complete Application with Integrated Routes (Using SHA1)
const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
require('dotenv').config();

const app = express();

// ====================
// MULTER CONFIGURATION
// ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// ====================
// DATABASE CONFIGURATION
// ====================
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promisePool = pool.promise();
app.locals.db = promisePool;

// ====================
// AUTHENTICATION MIDDLEWARE
// ====================
const isAuthenticated = (req, res, next) => {
    if (req.session.user && req.session.user.id) {
        return next();
    }
    req.flash('error_msg', 'Please login to access this page');
    res.redirect('/login');
};

const isNotAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        return next();
    }
    res.redirect('/tasks');
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.account_type === 'Admin') {
        return next();
    }
    req.flash('error_msg', 'Admin access required');
    res.redirect('/tasks');
};

const checkTaskOwnership = async (req, res, next) => {
    try {
        const taskId = req.params.id;
        const userId = req.session.user.id;
        
        const [task] = await req.app.locals.db.execute(
            'SELECT created_by FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (task.length === 0) {
            req.flash('error_msg', 'Task not found');
            return res.redirect('/tasks');
        }
        
        if (task[0].created_by !== userId && req.session.user.account_type !== 'Admin') {
            req.flash('error_msg', 'You do not have permission to edit this task');
            return res.redirect('/tasks');
        }
        
        next();
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Server error');
        res.redirect('/tasks');
    }
};

// ====================
// EXPRESS CONFIGURATION
// ====================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(flash());

// Global variables for views
app.use((req, res, next) => {
    const successMsgs = req.flash('success_msg');
    const errorMsgs = req.flash('error_msg');
    res.locals.success_msg = successMsgs.length ? successMsgs.join(', ') : '';
    res.locals.error_msg = errorMsgs.length ? errorMsgs.join(', ') : '';
    res.locals.user = req.session.user || null;
    next();
});

// ====================
// ROUTES - AUTHENTICATION
// ====================

// Home route
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success') });
});

// GET Login Page
app.get('/login', isNotAuthenticated, (req, res) => {
    res.render('auth/login', { 
        title: 'Login'
    });
});

// POST Login - Using SHA1() in MySQL query
app.post('/login', isNotAuthenticated, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            req.flash('error_msg', 'Please enter username and password');
            return res.redirect('/login');
        }
        
        const db = req.app.locals.db;
        
        // Check if user exists with SHA1 password match
        const [users] = await db.execute(
            'SELECT * FROM users WHERE username = ? AND password = SHA1(?)',
            [username, password]
        );
        
        if (users.length === 0) {
            req.flash('error_msg', 'Invalid credentials');
            return res.redirect('/login');
        }
        
        const user = users[0];
        
        // Store user in session (remove password)
        delete user.password;
        req.session.user = user;
        
        // Check if user is banned
        if (user.is_banned) {
            req.flash('error_msg', 'Your account has been banned. You cannot perform any actions.');
        }
        
        // Redirect based on account type
        if (user.account_type === 'Admin') {
            return res.redirect('/users/admin');
        }
        
        res.redirect('/tasks');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Server error');
        res.redirect('/login');
    }
});

// GET Register Page
app.get('/register', isNotAuthenticated, (req, res) => {
    res.render('auth/register', { 
        title: 'Register'
    });
});

// POST Register - Using SHA1() in MySQL query
app.post('/register', isNotAuthenticated, upload.single('profile_picture'), async (req, res) => {
    try {
        const { username, email, contact_number, password, confirm_password } = req.body;
        
        // Validation
        const errors = [];
        
        if (!username || !email || !password || !confirm_password) {
            errors.push('Please fill in all required fields');
        }
        
        if (password !== confirm_password) {
            errors.push('Passwords do not match');
        }
        
        if (password.length < 6) {
            errors.push('Password must be at least 6 characters');
        }
        
        if (errors.length > 0) {
            req.flash('error_msg', errors.join(', '));
            return res.redirect('/register');
        }
        
        const db = req.app.locals.db;
        
        // Check if username or email already exists
        const [existingUsers] = await db.execute(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, email]
        );
        
        if (existingUsers.length > 0) {
            req.flash('error_msg', 'Username or email already exists');
            return res.redirect('/register');
        }
        
        // Handle profile picture if uploaded
        let profilePicturePath = null;
        if (req.file) {
            profilePicturePath = '/images/' + req.file.filename;
        }
        
        // Insert user with SHA1 hashed password
        await db.execute(
            `INSERT INTO users (username, email, contact_number, password, profile_picture, account_type, role, is_banned) 
             VALUES (?, ?, ?, SHA1(?), ?, 'User', 'New User', FALSE)`,
            [username, email, contact_number || null, password, profilePicturePath]
        );
        
        req.flash('success_msg', 'Registration successful! Please login');
        res.redirect('/login');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Server error during registration');
        res.redirect('/register');
    }
});

// GET Logout
app.get('/logout', isAuthenticated, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
        }
        res.redirect('/');
    });
});

// ====================
// ROUTES - TASKS
// ====================

// GET All Tasks
app.get('/tasks', isAuthenticated, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.user.id;
        
        // Get tasks: user's personal tasks + all public tasks from other users
        const [tasks] = await db.execute(`
            SELECT t.*, u.username as creator_name 
            FROM tasks t
            JOIN users u ON t.created_by = u.id
            WHERE t.created_by = ? OR t.visibility = 'for all'
            ORDER BY t.created_at DESC
        `, [userId]);
        
        res.render('tasks/allTasks', {
            title: 'Tasks',
            tasks: tasks,
            user: req.session.user
        });
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading tasks');
        res.redirect('/tasks');
    }
});

// GET Create Task Form
app.get('/tasks/create', isAuthenticated, (req, res) => {
    if (req.session.user.is_banned) {
        req.flash('error_msg', 'Your account is banned. Cannot create tasks.');
        return res.redirect('/tasks');
    }
    
    res.render('tasks/create', {
        title: 'Create Task'
    });
});

// POST Create Task
app.post('/tasks/create', isAuthenticated, async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot create tasks.');
            return res.redirect('/tasks');
        }
        
        const { title, description, visibility } = req.body;
        const userId = req.session.user.id;
        
        if (!title) {
            req.flash('error_msg', 'Title is required');
            return res.redirect('/tasks/create');
        }
        
        const db = req.app.locals.db;
        
        await db.execute(
            'INSERT INTO tasks (title, description, visibility, created_by) VALUES (?, ?, ?, ?)',
            [title, description || '', visibility || 'personal', userId]
        );
        
        req.flash('success_msg', 'Task created successfully');
        res.redirect('/tasks');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error creating task');
        res.redirect('/tasks/create');
    }
});

// GET View Single Task
app.get('/tasks/view/:id', isAuthenticated, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.session.user.id;
        const db = req.app.locals.db;
        
        const [tasks] = await db.execute(`
            SELECT t.*, u.username as creator_name 
            FROM tasks t
            JOIN users u ON t.created_by = u.id
            WHERE t.id = ? AND (t.created_by = ? OR t.visibility = 'for all')
        `, [taskId, userId]);
        
        if (tasks.length === 0) {
            req.flash('error_msg', 'Task not found or no permission to view');
            return res.redirect('/tasks');
        }
        
        const task = tasks[0];
        const isOwner = task.created_by === userId;
        
        res.render('tasks/view', {
            title: `Task: ${task.title}`,
            task: task,
            isOwner: isOwner,
            user: req.session.user
        });
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading task');
        res.redirect('/tasks');
    }
});

// GET Edit Task Form
app.get('/tasks/edit/:id', isAuthenticated, checkTaskOwnership, async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot edit tasks.');
            return res.redirect('/tasks');
        }
        
        const taskId = req.params.id;
        const db = req.app.locals.db;
        
        const [tasks] = await db.execute(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (tasks.length === 0) {
            req.flash('error_msg', 'Task not found');
            return res.redirect('/tasks');
        }
        
        res.render('tasks/edit', {
            title: 'Edit Task',
            task: tasks[0]
        });
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading task');
        res.redirect('/tasks');
    }
});

// POST Update Task
app.post('/tasks/update/:id', isAuthenticated, checkTaskOwnership, async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot edit tasks.');
            return res.redirect('/tasks');
        }
        
        const taskId = req.params.id;
        const { title, description, visibility } = req.body;
        const db = req.app.locals.db;
        
        if (!title) {
            req.flash('error_msg', 'Title is required');
            return res.redirect(`/tasks/edit/${taskId}`);
        }
        
        await db.execute(
            'UPDATE tasks SET title = ?, description = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [title, description || '', visibility || 'personal', taskId]
        );
        
        req.flash('success_msg', 'Task updated successfully');
        res.redirect('/tasks');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error updating task');
        res.redirect(`/tasks/edit/${taskId}`);
    }
});

// GET Delete Task
app.get('/tasks/delete/:id', isAuthenticated, checkTaskOwnership, async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot delete tasks.');
            return res.redirect('/tasks');
        }
        
        const taskId = req.params.id;
        const db = req.app.locals.db;
        
        await db.execute('DELETE FROM tasks WHERE id = ?', [taskId]);
        
        req.flash('success_msg', 'Task deleted successfully');
        res.redirect('/tasks');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error deleting task');
        res.redirect('/tasks');
    }
});

// ====================
// ROUTES - USER PROFILE
// ====================

// GET User Profile
app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const db = req.app.locals.db;
        
        const [users] = await db.execute(
            'SELECT id, username, email, contact_number, profile_picture, account_type, role FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            req.flash('error_msg', 'User not found');
            return res.redirect('/tasks');
        }
        
        res.render('users/profile', {
            title: 'My Profile',
            userProfile: users[0],
            currentUser: req.session.user
        });
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading profile');
        res.redirect('/tasks');
    }
});

// GET Edit Profile Form
app.get('/users/edit-Profile', isAuthenticated, (req, res) => {
    if (req.session.user.is_banned) {
        req.flash('error_msg', 'Your account is banned. Cannot edit profile.');
        return res.redirect('/profile');
    }
    
    res.render('users/edit-Profile', {
        title: 'Edit Profile',
        user: req.session.user
    });
});

// POST Update Profile - Using SHA1() for password verification and update
app.post('/users/edit-Profile', isAuthenticated, upload.single('profile_picture'), async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot edit profile.');
            return res.redirect('/profile');
        }
        
        const userId = req.session.user.id;
        const { username, email, contact_number, current_password, new_password, confirm_password } = req.body;
        const db = req.app.locals.db;
        
        // Check if username or email already exists (excluding current user)
        const [existingUsers] = await db.execute(
            'SELECT * FROM users WHERE (username = ? OR email = ?) AND id != ?',
            [username, email, userId]
        );
        
        if (existingUsers.length > 0) {
            req.flash('error_msg', 'Username or email already exists');
            return res.redirect('/users/edit-Profile');
        }
        
        let updateFields = {
            username,
            email
        };
        
        // Only add contact_number if provided
        if (contact_number && contact_number.trim()) {
            updateFields.contact_number = contact_number;
        }
        
        // Handle profile picture if uploaded
        if (req.file) {
            updateFields.profile_picture = '/images/' + req.file.filename;
        }
        
        // If password change is requested
        if (new_password && new_password.trim()) {
            if (new_password.length < 6) {
                req.flash('error_msg', 'New password must be at least 6 characters');
                return res.redirect('/users/edit-Profile');
            }
            
            if (new_password !== confirm_password) {
                req.flash('error_msg', 'New passwords do not match');
                return res.redirect('/users/edit-Profile');
            }
            
            // Verify current password using SHA1
            const [users] = await db.execute(
                'SELECT id FROM users WHERE id = ? AND password = SHA1(?)',
                [userId, current_password]
            );
            
            if (users.length === 0) {
                req.flash('error_msg', 'Current password is incorrect');
                return res.redirect('/users/edit-Profile');
            }
        }
        
        // Build SQL update query - handle password separately to use SHA1() function
        let query, values;
        
        if (new_password && new_password.trim()) {
            // Include password update with SHA1()
            const otherFields = Object.keys(updateFields)
                .map(key => `${key} = ?`)
                .join(', ');
            query = `UPDATE users SET ${otherFields}, password = SHA1(?) WHERE id = ?`;
            values = [...Object.values(updateFields), new_password, userId];
        } else {
            // Update without password
            const fields = Object.keys(updateFields)
                .map(key => `${key} = ?`)
                .join(', ');
            query = `UPDATE users SET ${fields} WHERE id = ?`;
            values = [...Object.values(updateFields), userId];
        }
        
        await db.execute(query, values);
        
        // Update session
        const [updatedUser] = await db.execute(
            'SELECT id, username, email, contact_number, profile_picture, account_type, role, is_banned FROM users WHERE id = ?',
            [userId]
        );
        
        req.session.user = updatedUser[0];
        req.flash('success_msg', 'Profile updated successfully');
        res.redirect('/profile');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error updating profile');
        res.redirect('/users/edit-Profile');
    }
});

// POST Update Profile Picture
app.post('/profile/upload-picture', isAuthenticated, upload.single('profile_picture'), async (req, res) => {
    try {
        if (req.session.user.is_banned) {
            req.flash('error_msg', 'Your account is banned. Cannot update profile picture.');
            return res.redirect('/profile');
        }
        
        if (!req.file) {
            req.flash('error_msg', 'No file uploaded');
            return res.redirect('/users/edit-Profile');
        }
        
        const userId = req.session.user.id;
        const profilePicturePath = '/images/' + req.file.filename;
        const db = req.app.locals.db;
        
        await db.execute(
            'UPDATE users SET profile_picture = ? WHERE id = ?',
            [profilePicturePath, userId]
        );
        
        // Update session
        req.session.user.profile_picture = profilePicturePath;
        
        req.flash('success_msg', 'Profile picture updated successfully');
        res.redirect('/profile');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error uploading profile picture');
        res.redirect('/users/edit-Profile');
    }
});

// ====================
// ROUTES - ADMIN FUNCTIONS
// ====================

// GET Admin - All Users
app.get('/users/admin', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.db;
        
        const [users] = await db.execute(
            `SELECT id, username, email, contact_number, profile_picture, 
                    account_type, role, is_banned, created_at 
             FROM users 
             ORDER BY created_at DESC`
        );
        
        res.render('users/admin', {
            title: 'Admin - All Users',
            users: users
        });
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading users');
        res.redirect('/tasks');
    }
});

// POST Admin - Update User Role
app.post('/admin/update-role/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { role } = req.body;
        const db = req.app.locals.db;
        
        const validRoles = ['New User', 'Senior User', 'Group Leader'];
        if (!validRoles.includes(role)) {
            req.flash('error_msg', 'Invalid role');
            return res.redirect('/users/admin');
        }
        
        await db.execute(
            'UPDATE users SET role = ? WHERE id = ?',
            [role, userId]
        );
        
        req.flash('success_msg', 'User role updated successfully');
        res.redirect('/users/admin');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error updating user role');
        res.redirect('/users/admin');
    }
});

// POST Admin - Toggle Ban User
app.post('/admin/toggle-ban/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const db = req.app.locals.db;
        
        // Get current ban status
        const [users] = await db.execute(
            'SELECT is_banned FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            req.flash('error_msg', 'User not found');
            return res.redirect('/users/admin');
        }
        
        const newBanStatus = !users[0].is_banned;
        
        await db.execute(
            'UPDATE users SET is_banned = ? WHERE id = ?',
            [newBanStatus, userId]
        );
        
        const action = newBanStatus ? 'banned' : 'unbanned';
        req.flash('success_msg', `User ${action} successfully`);
        res.redirect('/users/admin');
        
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error updating user ban status');
        res.redirect('/users/admin');
    }
});

// ====================
// ERROR HANDLING & SERVER START
// ====================

// 404 page
app.use((req, res) => {
    res.status(404).render('404', { title: 'Page Not Found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        title: 'Server Error',
        message: err.message
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the application at http://localhost:${PORT}`);
});