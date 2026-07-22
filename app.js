require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const {
    checkAuthenticated,
    checkAdmin,
    checkTeacher,
    checkStudent
} = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARDS = {
    admin: '/admin',
    teacher: '/teacher',
    student: '/student'
};

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false }
});

console.log('Database pool initialized for:', process.env.DB_NAME);

const tables = [
        `CREATE TABLE IF NOT EXISTS admins (
            admin_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS students (
            student_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS teachers (
            teacher_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS teacher_slots (
            slot_id INT AUTO_INCREMENT PRIMARY KEY,
            teacher_id INT NOT NULL,
            subject VARCHAR(100) NOT NULL,
            location VARCHAR(100) NOT NULL,
            slot_date DATE NOT NULL,
            slot_time TIME NOT NULL,
            is_available TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS bookings (
            booking_id INT AUTO_INCREMENT PRIMARY KEY,
            slot_id INT NOT NULL,
            student_id INT NOT NULL,
            education_level VARCHAR(50) NOT NULL,
            class_size INT NOT NULL,
            status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (slot_id) REFERENCES teacher_slots(slot_id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS approvals (
            approval_id INT AUTO_INCREMENT PRIMARY KEY,
            requested_by_student_id INT,
            requested_by_teacher_id INT,
            reviewed_by INT,
            target_type ENUM('booking', 'slot'),
            target_id INT NOT NULL,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TIMESTAMP NULL,
            FOREIGN KEY (requested_by_student_id) REFERENCES students(student_id) ON DELETE CASCADE,
            FOREIGN KEY (requested_by_teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES admins(admin_id) ON DELETE SET NULL
        )`,
        `INSERT IGNORE INTO admins (email, full_name, password_hash, phone_number) VALUES ('admin@test.com', 'System Admin', SHA1('password123'), '98765432')`,
        `INSERT IGNORE INTO teachers (email, full_name, password_hash, phone_number) VALUES ('teacher@test.com', 'Jane Teacher', SHA1('password123'), '91234567')`
    ];

    let i = 0;
    function nextTable() {
        if (i < tables.length) {
            db.query(tables[i], (err) => {
                if (err) console.error('Error creating table:', err.message);
                i++;
                nextTable();
            });
        }
    }
    nextTable();

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET || 'development-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));
app.use(flash());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.successMessages = req.flash('success');
    res.locals.errorMessages = req.flash('error');
    next();
});

function dashboardFor(role) {
    return DASHBOARDS[role] || '/login';
}

function validateRegistration(req, res, next) {
    const full_name = (req.body.full_name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const phone_number = (req.body.phone_number || '').trim();

    req.body = { full_name, email, password, phone_number };

    if (!full_name || !email || !password || !phone_number) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return req.session.save(() => res.redirect('/register'));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        req.flash('error', 'Enter a valid email address.');
        req.flash('formData', req.body);
        return req.session.save(() => res.redirect('/register'));
    }
    if (password.length < 6) {
        req.flash('error', 'Password must contain at least 6 characters.');
        req.flash('formData', req.body);
        return req.session.save(() => res.redirect('/register'));
    }
    
    return next();
}

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect(dashboardFor(req.session.user.role));
    }
    res.render('register', { formData: req.flash('formData')[0] || {} });
});

app.post('/register', validateRegistration, (req, res) => {
    if (req.session.user) {
        return res.redirect(dashboardFor(req.session.user.role));
    }
    const { full_name, email, password, phone_number } = req.body;
    const sql = 'INSERT INTO students (full_name, email, password_hash, phone_number) VALUES (?, ?, SHA1(?), ?)';

    db.query(sql, [full_name, email, password, phone_number], (error) => {
        if (error) {
            console.error('Registration failed:', error.message);
            const message = error.code === 'ER_DUP_ENTRY'
                ? 'An account with that email already exists.'
                : 'DB Error: ' + error.message;
            req.flash('error', message);
            req.flash('formData', req.body);
            return req.session.save(() => res.redirect('/register'));
        }

        req.flash('success', 'Registration successful. You can now log in.');
        return req.session.save(() => res.redirect('/login'));
    });
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect(dashboardFor(req.session.user.role));
    }
    return res.render('login');
});

app.post('/login', (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
        req.flash('error', 'Email and password are required.');
        return res.redirect('/login');
    }

    const queries = [
        { role: 'student', sql: 'SELECT * FROM students WHERE email = ? AND password_hash = SHA1(?) LIMIT 1' },
        { role: 'teacher', sql: 'SELECT * FROM teachers WHERE email = ? AND password_hash = SHA1(?) LIMIT 1' },
        { role: 'admin', sql: 'SELECT * FROM admins WHERE email = ? AND password_hash = SHA1(?) LIMIT 1' }
    ];

    let queryIndex = 0;

    function checkNext() {
        if (queryIndex >= queries.length) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/login');
        }

        const current = queries[queryIndex];
        db.query(current.sql, [email, password], (error, results) => {
            if (error) {
                console.error('Login failed:', error.message);
                req.flash('error', 'Login is unavailable right now. Please try again.');
                return res.redirect('/login');
            }

            if (results.length > 0) {
                const databaseUser = results[0];
                const { password_hash, ...safeUser } = databaseUser;
                safeUser.role = current.role;
                safeUser.id = safeUser.student_id || safeUser.teacher_id || safeUser.admin_id;
                
                return req.session.regenerate((sessionError) => {
                    if (sessionError) {
                        console.error('Session creation failed:', sessionError.message);
                        return res.status(500).send('Unable to create a login session.');
                    }
                    req.session.user = safeUser;
                    req.flash('success', 'Welcome back, ' + safeUser.full_name + '.');
                    return req.session.save(() => res.redirect(dashboardFor(current.role)));
                });
            }

            queryIndex++;
            checkNext();
        });
    }

    checkNext();
});

app.get('/dashboard', checkAuthenticated, (req, res) => {
    res.redirect(dashboardFor(req.session.user.role));
});

// --- PROFILE ROUTES ---

app.get('/profile', checkAuthenticated, (req, res) => {
    res.render('profile', { formData: req.flash('formData')[0] || req.session.user });
});

app.post('/profile', checkAuthenticated, (req, res) => {
    const full_name = (req.body.full_name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone_number = (req.body.phone_number || '').trim();
    const password = req.body.password || '';

    if (!full_name || !email || !phone_number) {
        req.flash('error', 'Name, email, and phone number are required.');
        req.flash('formData', req.body);
        return req.session.save(() => res.redirect('/profile'));
    }

    const { role, id } = req.session.user;
    const table = role + 's';
    const idField = role + '_id';

    let sql, params;
    if (password) {
        if (password.length < 6) {
            req.flash('error', 'Password must contain at least 6 characters.');
            req.flash('formData', req.body);
            return req.session.save(() => res.redirect('/profile'));
        }
        sql = `UPDATE ${table} SET full_name = ?, email = ?, phone_number = ?, password_hash = SHA1(?) WHERE ${idField} = ?`;
        params = [full_name, email, phone_number, password, id];
    } else {
        sql = `UPDATE ${table} SET full_name = ?, email = ?, phone_number = ? WHERE ${idField} = ?`;
        params = [full_name, email, phone_number, id];
    }

    db.query(sql, params, (error) => {
        if (error) {
            console.error('Profile update failed:', error.message);
            const message = error.code === 'ER_DUP_ENTRY'
                ? 'An account with that email already exists.'
                : 'Failed to update profile: ' + error.message;
            req.flash('error', message);
            req.flash('formData', req.body);
            return req.session.save(() => res.redirect('/profile'));
        }

        req.session.user.full_name = full_name;
        req.session.user.email = email;
        req.session.user.phone_number = phone_number;
        req.flash('success', 'Profile updated successfully.');
        return req.session.save(() => res.redirect('/profile'));
    });
});

app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    db.query('SELECT *, "Admin" as role FROM admins', (err, admins) => {
        db.query('SELECT *, "Teacher" as role FROM teachers', (err, teachers) => {
            db.query('SELECT *, "Student" as role FROM students', (err, students) => {
                let users = [];
                if (admins) users = users.concat(admins);
                if (teachers) users = users.concat(teachers);
                if (students) users = users.concat(students);
                res.render('admin', { users, loadError: null });
            });
        });
    });
});

app.get('/teacher', checkAuthenticated, checkTeacher, (req, res) => {
    res.render('teacher');
});

app.get('/student', checkAuthenticated, checkStudent, (req, res) => {
    res.render('student');
});

// --- TEACHER SLOTS ROUTES ---

app.get('/teacher/slots', checkAuthenticated, checkTeacher, (req, res) => {
    const sql = 'SELECT * FROM teacher_slots WHERE teacher_id = ? ORDER BY slot_date, slot_time';
    db.query(sql, [req.session.user.id], (error, slots) => {
        if (error) {
            req.flash('error', 'Could not load slots.');
            return res.redirect('/teacher');
        }
        res.render('teacher_slots', { slots });
    });
});

app.get('/teacher/slots/new', checkAuthenticated, checkTeacher, (req, res) => {
    res.render('teacher_slot_form', { slot: {} });
});

app.post('/teacher/slots/new', checkAuthenticated, checkTeacher, (req, res) => {
    const { subject, location, slot_date, slot_time } = req.body;
    const sql = 'INSERT INTO teacher_slots (teacher_id, subject, location, slot_date, slot_time) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [req.session.user.id, subject, location, slot_date, slot_time], (error) => {
        if (error) {
            req.flash('error', 'Failed to create slot.');
            return res.redirect('/teacher/slots/new');
        }
        req.flash('success', 'Slot created successfully.');
        res.redirect('/teacher/slots');
    });
});

app.post('/teacher/slots/:id/delete', checkAuthenticated, checkTeacher, (req, res) => {
    const sql = 'DELETE FROM teacher_slots WHERE slot_id = ? AND teacher_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (error) => {
        if (error) req.flash('error', 'Failed to delete slot.');
        else req.flash('success', 'Slot deleted.');
        res.redirect('/teacher/slots');
    });
});

// --- TEACHER BOOKING APPROVALS ---

app.get('/teacher/bookings', checkAuthenticated, checkTeacher, (req, res) => {
    const sql = `
        SELECT b.*, ts.subject, ts.slot_date, ts.slot_time, s.full_name as student_name, s.email as student_email
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        JOIN students s ON b.student_id = s.student_id
        WHERE ts.teacher_id = ?
        ORDER BY b.created_at DESC
    `;
    db.query(sql, [req.session.user.id], (error, bookings) => {
        if (error) {
            req.flash('error', 'Could not load bookings.');
            return res.redirect('/teacher');
        }
        res.render('teacher_bookings', { bookings });
    });
});

app.post('/teacher/bookings/:id/status', checkAuthenticated, checkTeacher, (req, res) => {
    const { status } = req.body; // 'approved' or 'rejected'
    if (status !== 'approved' && status !== 'rejected') return res.redirect('/teacher/bookings');
    
    // Ensure the booking belongs to this teacher's slot
    const verifySql = 'SELECT ts.teacher_id FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE b.booking_id = ?';
    db.query(verifySql, [req.params.id], (err, results) => {
        if (err || results.length === 0 || results[0].teacher_id !== req.session.user.id) {
            req.flash('error', 'Unauthorized.');
            return res.redirect('/teacher/bookings');
        }
        
        const sql = 'UPDATE bookings SET status = ? WHERE booking_id = ?';
        db.query(sql, [status, req.params.id], (error) => {
            if (error) req.flash('error', 'Failed to update booking status.');
            else {
                req.flash('success', 'Booking marked as ' + status + '.');
                // Create an approval record for audit trail
                const approvalSql = 'INSERT INTO approvals (requested_by_student_id, reviewed_by, target_type, target_id, status) SELECT student_id, ?, "booking", ?, ? FROM bookings WHERE booking_id = ?';
                db.query(approvalSql, [req.session.user.id, req.params.id, status, req.params.id]);
            }
            res.redirect('/teacher/bookings');
        });
    });
});

// --- STUDENT BOOKING ROUTES ---

app.get('/student/slots', checkAuthenticated, checkStudent, (req, res) => {
    const sql = `
        SELECT ts.*, t.full_name as teacher_name,
               (SELECT status FROM bookings b WHERE b.slot_id = ts.slot_id AND b.student_id = ?) as my_status
        FROM teacher_slots ts
        JOIN teachers t ON ts.teacher_id = t.teacher_id
        WHERE ts.is_available = 1
        ORDER BY ts.slot_date, ts.slot_time
    `;
    db.query(sql, [req.session.user.id], (error, slots) => {
        if (error) {
            req.flash('error', 'Could not load available slots.');
            return res.redirect('/student');
        }
        res.render('student_slots', { slots });
    });
});

app.post('/student/slots/:id/book', checkAuthenticated, checkStudent, (req, res) => {
    const { education_level, class_size } = req.body;
    const slotId = req.params.id;
    const studentId = req.session.user.id;
    
    const sql = 'INSERT INTO bookings (slot_id, student_id, education_level, class_size, status) VALUES (?, ?, ?, ?, "pending")';
    db.query(sql, [slotId, studentId, education_level || 'General', class_size || 1], (error) => {
        if (error) req.flash('error', 'Failed to book slot.');
        else req.flash('success', 'Slot booking requested! Pending teacher approval.');
        res.redirect('/student/my-bookings');
    });
});

app.get('/student/my-bookings', checkAuthenticated, checkStudent, (req, res) => {
    const sql = `
        SELECT b.*, ts.subject, ts.location, ts.slot_date, ts.slot_time, t.full_name as teacher_name
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        JOIN teachers t ON ts.teacher_id = t.teacher_id
        WHERE b.student_id = ?
        ORDER BY b.created_at DESC
    `;
    db.query(sql, [req.session.user.id], (error, bookings) => {
        if (error) {
            req.flash('error', 'Could not load your bookings.');
            return res.redirect('/student');
        }
        res.render('student_bookings', { bookings });
    });
});

app.post('/student/bookings/:id/cancel', checkAuthenticated, checkStudent, (req, res) => {
    const sql = 'UPDATE bookings SET status = "cancelled" WHERE booking_id = ? AND student_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (error) => {
        if (error) req.flash('error', 'Failed to cancel booking.');
        else req.flash('success', 'Booking cancelled.');
        res.redirect('/student/my-bookings');
    });
});

function logout(req, res) {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
}

app.get('/logout', logout);
app.post('/logout', logout);

app.use((req, res) => {
    res.status(404).render('404');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log('TutorLink is running on http://localhost:' + PORT);
    });
}

module.exports = app;
