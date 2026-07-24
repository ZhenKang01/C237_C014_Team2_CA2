require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const session = require('express-session'); 
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
//const multer = require('multer');
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

const sessionStore = new MySQLStore({}, db.promise());
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
            onboarding_completed TINYINT(1) DEFAULT 0,
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
            end_time TIME NOT NULL,
            is_available TINYINT(1) DEFAULT 1,
            capacity INT NOT NULL DEFAULT 1,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
            created_by ENUM('teacher', 'admin') DEFAULT 'teacher',
            reject_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS bookings (
            booking_id INT AUTO_INCREMENT PRIMARY KEY,
            slot_id INT NOT NULL,
            student_reason TEXT,
            student_id INT NOT NULL,
            class_size INT NOT NULL,
            description TEXT,
            status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
            reject_reason TEXT,
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
        `INSERT IGNORE INTO teachers (email, full_name, password_hash, phone_number) VALUES ('teacher@test.com', 'Jane Teacher', SHA1('password123'), '91234567')`,
        `ALTER TABLE teacher_slots ADD COLUMN capacity INT NOT NULL DEFAULT 1`,
        `ALTER TABLE teacher_slots ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved'`,
        `ALTER TABLE teacher_slots ADD COLUMN created_by ENUM('teacher', 'admin') DEFAULT 'teacher'`,
        `ALTER TABLE teacher_slots ADD COLUMN reject_reason TEXT`,
        `ALTER TABLE students ADD COLUMN onboarding_completed TINYINT(1) DEFAULT 0`,
    ];

const upload = multer({ storage });

    
    /// Jenita ///
    let i = 0;
    function nextTable() {
        if (i < tables.length) {
            db.query(tables[i], (err) => {
                if(
                    err &&
                    err.code !== 'ER_DUP_FIELDNAME' 
                ) {
                    console.error('Error creating table:', err.message);
                }

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
    store: sessionStore,
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
    res.locals.formatTime = (timeStr) => {
        if (!timeStr) return '--:--';
        const [hour, minute] = timeStr.split(':');
        const h = parseInt(hour, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${minute} ${ampm}`;
    };
    next();
});

function dashboardFor(role) {
    return DASHBOARDS[role] || '/login';
}

function checkTeacherAvailability(teacherId, slotDate, slotTime, callback) {
    const sql = `
        SELECT slot_id
        FROM teacher_slots
        WHERE teacher_id = ?
          AND slot_date = ?
          AND slot_time = ?
          AND is_available = 1
        LIMIT 1
    `;

    db.query(sql, [teacherId, slotDate, slotTime], (error, results) => {
        if (error) {
            return callback(error);
        }

        return callback(null, results.length === 0);
    });
}

function isPastDate(dateInput) {
    const d = new Date(dateInput);
    const today = new Date();
    d.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return d < today;
}
///////// Jenita - Login and Registration Validation //////////

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

if (
    current.role === 'student' &&
    safeUser.onboarding_completed == 0
) {
    return req.session.save(() => res.redirect('/student/share'));
}

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
///////  Jenita - Login and Registration Validation End ///////



// --- PROFILE ROUTES ---

app.get('/profile', checkAuthenticated, (req, res) => {
    res.render('profile', { formData: req.flash('formData')[0] || req.session.user });
});

app.post('/profile', checkAuthenticated, (req, res) => {
    const full_name = (req.body.full_name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone_number = (req.body.phone_number || '').trim();
    const password = req.body.password || '';

    

//if (req.file) {
    //profile_image = req.file.path; // Cloudinary URL


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

    sql = `
        UPDATE ${table}
        SET full_name = ?,
            email = ?,
            phone_number = ?,
            password_hash = SHA1(?)
        WHERE ${idField} = ?
    `;

    params = [
        full_name,
        email,
        phone_number,
        password,
        id
    ];

} else {

    sql = `
        UPDATE ${table}
        SET full_name = ?,
            email = ?,
            phone_number = ?
        WHERE ${idField} = ?
    `;

    params = [
        full_name,
        email,
        phone_number,
        id
    ];
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
    const tid = req.session.user.id;
    const q1 = 'SELECT COUNT(*) AS total_slots FROM teacher_slots WHERE teacher_id = ?';
    const q2 = 'SELECT COUNT(*) AS pending_bookings FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE ts.teacher_id = ? AND b.status = "pending"';
    const q3 = 'SELECT ts.subject, ts.slot_date, ts.slot_time FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE ts.teacher_id = ? AND b.status = "approved" AND ts.slot_date >= CURDATE() ORDER BY ts.slot_date ASC, ts.slot_time ASC LIMIT 1';
    const q4 = 'SELECT b.*, ts.subject, ts.location, ts.slot_date, ts.slot_time, s.full_name as student_name FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id JOIN students s ON b.student_id = s.student_id WHERE ts.teacher_id = ? AND b.status = "approved"';
    
    db.query(q1, [tid], (e1, r1) => {
        db.query(q2, [tid], (e2, r2) => {
            db.query(q3, [tid], (e3, r3) => {
                db.query(q4, [tid], (e4, r4) => {
                    const groupedBookingsMap = {};
                    (r4 || []).forEach(b => {
                        if (!groupedBookingsMap[b.slot_id]) {
                            groupedBookingsMap[b.slot_id] = {
                                slot_id: b.slot_id,
                                subject: b.subject,
                                location: b.location,
                                slot_date: b.slot_date,
                                slot_time: res.locals.formatTime(b.slot_time),
                                students: []
                            };
                        }
                        groupedBookingsMap[b.slot_id].students.push({
                            name: b.student_name,
                            message: b.description || 'No message provided.'
                        });
                    });
                    const groupedBookings = Object.values(groupedBookingsMap);
                    
                    res.render('teacher', {
                        totalSlots: r1?.[0]?.total_slots || 0,
                        pendingBookings: r2?.[0]?.pending_bookings || 0,
                        nextSession: r3?.[0] || null,
                        bookings: groupedBookings
                    });
                });
            });
        });
    });
});


/// jenita - enhancement feature - sharelink + tutorial ///
// =====================
// Student Onboarding
// =====================

// Share page
app.get('/student/share', checkAuthenticated, checkStudent, (req, res) => {
    res.render('share', {
        shareUrl: `${req.protocol}://${req.get('host')}/register`
    });
});

// Tutorial page
app.get('/tutorial', checkAuthenticated, checkStudent, (req, res) => {
    res.render('tutorial');
});

// Finish tutorial
app.get('/tutorial/finish', checkAuthenticated, checkStudent, (req, res) => {

    db.query(
        "UPDATE students SET onboarding_completed = 1 WHERE student_id = ?",
        [req.session.user.id],
        (err) => {

            if (err) {
                console.error(err);
            }

            req.session.user.onboarding_completed = 1;

            res.redirect('/student');
        }
    );

});

// =====================
// Student Dashboard
// =====================

app.get('/student', checkAuthenticated, checkStudent, (req, res) => {
    const sid = req.session.user.id;
    const q1 = 'SELECT COUNT(*) AS total_bookings FROM bookings WHERE student_id = ?';
    const q2 = 'SELECT COUNT(*) AS pending_approvals FROM bookings WHERE student_id = ? AND status = "pending"';
    const q3 = 'SELECT ts.slot_date, ts.slot_time FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE b.student_id = ? AND b.status = "approved" AND ts.slot_date >= CURDATE() ORDER BY ts.slot_date ASC, ts.slot_time ASC LIMIT 1';
    
    db.query(q1, [sid], (e1, r1) => {
        db.query(q2, [sid], (e2, r2) => {
            db.query(q3, [sid], (e3, r3) => {
                res.render('student', {
                    totalBookings: r1?.[0]?.total_bookings || 0,
                    pendingApprovals: r2?.[0]?.pending_approvals || 0,
                    nextSession: r3?.[0] || null
                });
            });
        });
    });
});

// --- ADMIN USER ROUTES ---
/// 

app.get('/admin/users/new', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('admin_user_form', { targetUser: {}, role: 'student' });
});

app.post('/admin/users/new', checkAuthenticated, checkAdmin, (req, res) => {
    const { full_name, email, phone_number, password, role } = req.body;
    if (!full_name || !email || !phone_number || !password || !role) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/admin/users/new');
    }
    const table = role + 's';
    const sql = `INSERT INTO ${table} (full_name, email, phone_number, password_hash) VALUES (?, ?, ?, SHA1(?))`;
    
    // Check if table is valid
    if (!['admins', 'teachers', 'students'].includes(table)) {
        req.flash('error', 'Invalid role.');
        return res.redirect('/admin/users/new');
    }

    db.query(sql, [full_name, email, phone_number, password], (error) => {
        if (error) {
            req.flash('error', error.code === 'ER_DUP_ENTRY' ? 'Email already exists.' : 'Failed to create user.');
            return res.redirect('/admin/users/new');
        }
        req.flash('success', 'User created successfully.');
        res.redirect('/admin');
    });
});
/// Jereil - Admin View & Edit ////
app.get('/admin/users/:role/:id/edit', checkAuthenticated, checkAdmin, (req, res) => {
    const { role, id } = req.params;
    const table = role + 's';
    const idField = role + '_id';
    
    if (!['admins', 'teachers', 'students'].includes(table)) return res.redirect('/admin');

    const sql = `SELECT * FROM ${table} WHERE ${idField} = ?`;
    db.query(sql, [id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin');
        }
        res.render('admin_user_form', { targetUser: results[0], role });
    });
});

app.post('/admin/users/:role/:id/edit', checkAuthenticated, checkAdmin, (req, res) => {
    const { role, id } = req.params;
    const { full_name, email, phone_number, password } = req.body;
    const table = role + 's';
    const idField = role + '_id';
    
    if (!['admins', 'teachers', 'students'].includes(table)) return res.redirect('/admin');
    if (!full_name || !email || !phone_number) {
        req.flash('error', 'Name, email, and phone number are required.');
        return res.redirect(`/admin/users/${role}/${id}/edit`);
    }

    let sql, params;
    if (password) {
        sql = `UPDATE ${table} SET full_name = ?, email = ?, phone_number = ?, password_hash = SHA1(?) WHERE ${idField} = ?`;
        params = [full_name, email, phone_number, password, id];
    } else {
        sql = `UPDATE ${table} SET full_name = ?, email = ?, phone_number = ? WHERE ${idField} = ?`;
        params = [full_name, email, phone_number, id];
    }

    db.query(sql, params, (error) => {
        if (error) {
            req.flash('error', error.code === 'ER_DUP_ENTRY' ? 'Email already exists.' : 'Failed to update user.');
            return res.redirect(`/admin/users/${role}/${id}/edit`);
        }
        req.flash('success', 'User updated successfully.');
        res.redirect('/admin');
    });
});

app.post('/admin/users/:role/:id/delete', checkAuthenticated, checkAdmin, (req, res) => {
    const { role, id } = req.params;
    const table = role + 's';
    const idField = role + '_id';
    
    if (!['admins', 'teachers', 'students'].includes(table)) return res.redirect('/admin');

    db.query(`SELECT email FROM ${table} WHERE ${idField} = ?`, [id], (err, results) => {
        if (!err && results.length > 0 && results[0].email === 'admin@test.com') {
            req.flash('error', 'The master admin account (admin@test.com) cannot be deleted.');
            return res.redirect('/admin');
        }

        const sql = `DELETE FROM ${table} WHERE ${idField} = ?`;
        db.query(sql, [id], (error) => {
            if (error) req.flash('error', 'Failed to delete user.');
            else req.flash('success', 'User deleted successfully.');
            res.redirect('/admin');
        });
    });
});

/// JENITA ADMIN ADD SCHEDULE ///

app.get('/admin/addschedule', checkAuthenticated, checkAdmin, (req, res) => {
    db.query('SELECT teacher_id, full_name, email FROM teachers ORDER BY full_name ASC', (error, teachers) => {
        if (error) {
            req.flash('error', 'Could not load teachers for schedule creation.');
            return res.redirect('/admin');
        }

        //if (isPastDate(slot_date)) {
           // req.flash('error', 'Cannot create a schedule for a past date.');
            //return res.redirect('/admin/addschedule');
        //}

        return res.render('admin_schedule', { teachers });
    });
});

app.post('/admin/addschedule', checkAuthenticated, checkAdmin, (req, res) => {
    const { teacher_id, subject, location, slot_date, slot_time, end_time } = req.body;

    if (isPastDate(slot_date)) {
    req.flash('error', 'Cannot create a schedule for a past date.');
    return res.redirect('/admin/addschedule');
}

    if (!teacher_id || !subject || !location || !slot_date || !slot_time || !end_time) {
        req.flash('error', 'All schedule fields are required.');
        return res.redirect('/admin/addschedule');
    }

    const teacherCheckSql = 'SELECT teacher_id, full_name FROM teachers WHERE teacher_id = ? LIMIT 1';
    db.query(teacherCheckSql, [teacher_id], (teacherError, teacherResults) => {
        if (teacherError) {
            req.flash('error', 'Unable to verify teacher availability right now.');
            return res.redirect('/admin/addschedule');
        }

        if (!teacherResults.length) {
            req.flash('error', 'Selected teacher does not exist.');
            return res.redirect('/admin/addschedule');
        }

        checkTeacherAvailability(teacher_id, slot_date, slot_time, (availabilityError, isAvailable) => {
            if (availabilityError) {
                req.flash('error', 'Could not check teacher availability.');
                return res.redirect('/admin/addschedule');
            }

            if (!isAvailable) {
                req.flash('error', 'This teacher is already scheduled for the selected date and time.');
                return res.redirect('/admin/addschedule');
            }

            const insertSql = 'INSERT INTO teacher_slots (teacher_id, subject, location, slot_date, slot_time, end_time, capacity, is_available, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, "pending", "admin")';
            db.query(insertSql, [teacher_id, subject.trim(), location.trim(), slot_date, slot_time, end_time, req.body.capacity || 1], (insertError) => {
                if (insertError) {
                    req.flash('error', 'Failed to create the session schedule.');
                    return res.redirect('/admin/addschedule');
                }

                req.flash('success', 'Schedule created successfully for ' + teacherResults[0].full_name + '.');
                return res.redirect('/admin/addschedule');
            });
        });
    });
});

///////  Jeriel - View and Update Schedules (Admin) ///////

app.get('/admin/schedules', checkAuthenticated, checkAdmin, (req, res) => {
    const sql = `SELECT ts.*, t.full_name as teacher_name
    FROM teacher_slots ts
    JOIN teachers t ON ts.teacher_id = t.teacher_id
    ORDER BY slot_date, slot_time`;
    db.query(sql, (error, slots) => {
        if (error) {
            req.flash('error', 'Could not load schedules.');
            return res.redirect('/admin');
        }
        res.render('admin_schedules', { slots });
    });
});

app.get('/admin/schedules/:id/edit', checkAuthenticated, checkAdmin, (req, res) => {
    const sql = `SELECT ts.*, t.full_name as teacher_name
    FROM teacher_slots ts
    JOIN teachers t ON ts.teacher_id = t.teacher_id
    WHERE slot_id = ?`;
    db.query(sql, [req.params.id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'Could not load slot data.');
            return res.redirect('/admin/schedules');
        }
        db.query('SELECT * FROM teachers', (error, teachers) => {
            res.render('admin_schedule_edit', { slot: results[0], teachers });
        });
    });
});

app.post('/admin/schedules/:id/edit', checkAuthenticated, checkAdmin, (req, res) => {
    const slot_id = req.params.id;
    const { teacher_id, subject, location, slot_date, slot_time, end_time, capacity } = req.body;
    const sql = 'UPDATE teacher_slots SET teacher_id = ?, subject = ?, location = ?, slot_date = ?, slot_time = ?, end_time = ?, capacity = ? WHERE slot_id = ?';
    db.query(sql, [teacher_id, subject, location, slot_date, slot_time, end_time, capacity || 1, slot_id], (error) => {
        if (error) {
            req.flash('error', 'Failed to update schedule.');
        } else {
            req.flash('success', 'Slot updated successfully.');
        }
        res.redirect('/admin/schedules');
    });
});

///////  Jeriel - View and Update Schedules (Admin) End ///////

app.post('/admin/schedules/:id/delete', checkAuthenticated, checkAdmin, (req, res) => {
    const sql = 'DELETE FROM teacher_slots WHERE slot_id = ?';
    db.query(sql, [req.params.id], (error) => {
        if (error) req.flash('error', 'Failed to delete slot.');
        else req.flash('success', 'Slot deleted successfully.');
        res.redirect('/admin/schedules');
    });
});

// --- TEACHER SLOTS ROUTES ---
/// Hein - Teacher Slots Management ///
/// Hein - Teaacher slots search and filter by subject and location ///
app.get('/teacher/slots', checkAuthenticated, checkTeacher, (req, res) => {
    const subject = req.query.subject || '';
    const location = req.query.location || '';
    const tid = req.session.user.id;
    
    const sqlSlots = `SELECT * FROM teacher_slots WHERE teacher_id = ? AND subject LIKE ? AND location LIKE ? ORDER BY slot_date, slot_time`;
    const sqlBookings = `SELECT b.slot_id, b.status, s.full_name as student_name FROM bookings b JOIN students s ON b.student_id = s.student_id JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE ts.teacher_id = ? AND b.status IN ('approved', 'pending')`;
    
    db.query(sqlSlots, [tid, '%' + subject + '%', '%' + location + '%'], (error, slots) => {
        if (error) {
            req.flash('error', 'Could not load slots.');
            return res.redirect('/teacher');
        }

        db.query(sqlBookings, [tid], (err2, bookings) => {
            if (err2) bookings = [];

            // Attach bookings and calculate slots left for each slot
            slots.forEach(slot => {
                const slotBookings = bookings.filter(b => b.slot_id === slot.slot_id);
                slot.booked_students = slotBookings;
                slot.slots_left = slot.capacity - slotBookings.length;
            });

            res.render('teacher_slots', {
                slots: slots,
                subject: subject,
                location: location
            });
        });
    });
});
/// Hein - Teacher Add New Slot ///
app.get('/teacher/slots/new', checkAuthenticated, checkTeacher, (req, res) => {
    res.render('teacher_slot_form', { slot: {} });
});

app.post('/teacher/slots/new', checkAuthenticated, checkTeacher, (req, res) => {
    const { subject, location, slot_date, slot_time, end_time, capacity } = req.body;
    const sql = 'INSERT INTO teacher_slots (teacher_id, subject, location, slot_date, slot_time, end_time, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [req.session.user.id, subject.trim(), location.trim(), slot_date, slot_time, end_time, capacity || 1], (error) => {
        if (error) {
            req.flash('error', 'Failed to create slot.');
            return res.redirect('/teacher/slots/new');
        }
        req.flash('success', 'Slot created successfully.');
        res.redirect('/teacher/slots');
    });
});

app.post('/teacher/slots/:id/accept', checkAuthenticated, checkTeacher, (req, res) => {
    const sql = 'UPDATE teacher_slots SET status = "approved" WHERE slot_id = ? AND teacher_id = ? AND status = "pending"';
    db.query(sql, [req.params.id, req.session.user.id], (error) => {
        if (error) req.flash('error', 'Failed to accept slot.');
        else req.flash('success', 'Slot accepted.');
        res.redirect('/teacher/slots');
    });
});

app.post('/teacher/slots/:id/reject', checkAuthenticated, checkTeacher, (req, res) => {
    const { reject_reason } = req.body;
    if (!reject_reason || !reject_reason.trim()) {
        req.flash('error', 'Rejection reason is required.');
        return res.redirect('/teacher/slots');
    }
    const sql = 'UPDATE teacher_slots SET status = "rejected", reject_reason = ? WHERE slot_id = ? AND teacher_id = ? AND status = "pending"';
    db.query(sql, [reject_reason.trim(), req.params.id, req.session.user.id], (error) => {
        if (error) req.flash('error', 'Failed to reject slot.');
        else req.flash('success', 'Slot rejected.');
        res.redirect('/teacher/slots');
    });
});

app.post('/teacher/slots/:id/delete', checkAuthenticated, checkTeacher, (req, res) => {
    const checkSql = 'SELECT slot_date FROM teacher_slots WHERE slot_id = ? AND teacher_id = ?';
    db.query(checkSql, [req.params.id, req.session.user.id], (checkError, results) => {
        if (checkError || results.length === 0) {
            req.flash('error', 'Slot not found.');
            return res.redirect('/teacher/slots');
        }
        if (isPastDate(results[0].slot_date)) {
            req.flash('error', 'Past schedules are inactive and cannot be deleted.');
            return res.redirect('/teacher/slots');
        }

        const sql = 'DELETE FROM teacher_slots WHERE slot_id = ? AND teacher_id = ?';
        db.query(sql, [req.params.id, req.session.user.id], (error) => {
            if (error) req.flash('error', 'Failed to delete slot.');
            else req.flash('success', 'Slot deleted.');
            res.redirect('/teacher/slots');
        });
    });
});

/// Hein - Teacher Edit Slot (with past date check) ///

app.get('/teacher/slots/:id/edit', checkAuthenticated, checkTeacher, (req, res) => {
    const sql = 'SELECT * FROM teacher_slots WHERE slot_id = ? AND teacher_id = ?';
    db.query(sql, [req.params.id, req.session.user.id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'Slot not found.');
            return res.redirect('/teacher/slots');
        }
        if (isPastDate(results[0].slot_date)) {
            req.flash('error', 'Past schedules are inactive and cannot be edited.');
            return res.redirect('/teacher/slots');
        }
        res.render('teacher_slot_edit', { slot: results[0] });
    });
});

app.post('/teacher/slots/:id/edit', checkAuthenticated, checkTeacher, (req, res) => {
    const { subject, location, slot_date, slot_time, end_time } = req.body;

    const checkSql = 'SELECT slot_date FROM teacher_slots WHERE slot_id = ? AND teacher_id = ?';
    db.query(checkSql, [req.params.id, req.session.user.id], (checkError, results) => {
        if (checkError || results.length === 0) {
            req.flash('error', 'Slot not found.');
            return res.redirect('/teacher/slots');
        }
        if (isPastDate(results[0].slot_date)) {
            req.flash('error', 'Past schedules are inactive and cannot be edited.');
            return res.redirect('/teacher/slots');
        }

        const sql = 'UPDATE teacher_slots SET subject = ?, location = ?, slot_date = ?, slot_time = ?, end_time = ? WHERE slot_id = ? AND teacher_id = ?';
        db.query(sql, [subject, location, slot_date, slot_time, end_time, req.params.id, req.session.user.id], (error) => {
            if (error) {
                req.flash('error', 'Failed to update slot.');
                return res.redirect(`/teacher/slots/${req.params.id}/edit`);
            }
            req.flash('success', 'Slot updated successfully.');
            res.redirect('/teacher/slots');
        });
    });
});


/// Hein - Teacher View Bookings (with search and filter) ///
app.get('/teacher/bookings', checkAuthenticated, checkTeacher, (req, res) => {

    const student = req.query.student || '';
    const status = req.query.status || '';

    let sql = `
        SELECT b.*, ts.subject, ts.slot_date, ts.slot_time, ts.end_time,
               s.full_name AS student_name,
               s.email AS student_email
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        JOIN students s ON b.student_id = s.student_id
        WHERE ts.teacher_id = ?
        AND s.full_name LIKE ?
    `;

    const values = [
        req.session.user.id,
        '%' + student + '%'
    ];

    if (status !== '') {
        sql += " AND b.status = ?";
        values.push(status);
    }

    sql += " ORDER BY b.created_at DESC";

    db.query(sql, values, (error, bookings) => {
        if (error) {
            req.flash('error', 'Could not load bookings.');
            return res.redirect('/teacher');
        }

        res.render('teacher_bookings', {
            bookings,
            student,
            status
        });
    });

});




app.post('/teacher/bookings/:id/status', checkAuthenticated, checkTeacher, (req, res) => {
    const { status, reject_reason } = req.body; // 'approved' or 'rejected'
    if (status !== 'approved' && status !== 'rejected') return res.redirect('/teacher/bookings');
    
    // Ensure the booking belongs to this teacher's slot
    const verifySql = 'SELECT ts.teacher_id FROM bookings b JOIN teacher_slots ts ON b.slot_id = ts.slot_id WHERE b.booking_id = ?';
    db.query(verifySql, [req.params.id], (err, results) => {
        if (err || results.length === 0 || results[0].teacher_id !== req.session.user.id) {
            req.flash('error', 'Unauthorized.');
            return res.redirect('/teacher/bookings');
        }
        
        const sql = 'UPDATE bookings SET status = ?, reject_reason = ? WHERE booking_id = ?';
        db.query(sql, [status, reject_reason || null, req.params.id], (error) => {
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


/// Jayden and Tian Le///

app.get('/student/slots', checkAuthenticated, checkStudent, (req, res) => {
    const teacherName = req.query.teacher || '';
    const subject = req.query.subject || '';
    const location = req.query.location || '';

    const sql = `
        SELECT ts.*, t.full_name as teacher_name,
               (SELECT status FROM bookings b WHERE b.slot_id = ts.slot_id AND b.student_id = ?) as my_status,
               (SELECT COALESCE(SUM(class_size), 0) FROM bookings b WHERE b.slot_id = ts.slot_id AND b.status IN ('pending', 'approved')) as booked_slots
        FROM teacher_slots ts
        JOIN teachers t ON ts.teacher_id = t.teacher_id
        WHERE ts.is_available = 1 AND ts.status = 'approved' AND ts.slot_date >= CURDATE()
          AND t.full_name LIKE ?
          AND ts.subject LIKE ?
          AND ts.location LIKE ?
        ORDER BY ts.created_at DESC
    `;
    db.query(sql, [req.session.user.id, '%' + teacherName + '%', '%' + subject + '%', '%' + location + '%'], (error, slots) => {
        if (error) {
            req.flash('error', 'Could not load available slots.');
            return res.redirect('/student');
        }
        res.render('student_slots', { slots, teacherName, subject, location });
    });
});

app.post('/student/slots/:id/book', checkAuthenticated, checkStudent, (req, res) => {
    const { description } = req.body;
    const slotId = req.params.id;
    const studentId = req.session.user.id;
    
    db.query('SELECT capacity, slot_date, (SELECT COALESCE(SUM(class_size), 0) FROM bookings b WHERE b.slot_id = ts.slot_id AND b.status IN ("pending", "approved")) as booked_slots FROM teacher_slots ts WHERE slot_id = ?', [slotId], (err, results) => {
        if (err || results.length === 0) {
            req.flash('error', 'Failed to retrieve slot information.');
            return res.redirect('/student/slots');
        }

        if (isPastDate(results[0].slot_date)) {
            req.flash('error', 'This slot has already passed and can no longer be booked.');
            return res.redirect('/student/slots');
        }
        
        if (results[0].booked_slots >= results[0].capacity) {
            req.flash('error', 'Sorry, this slot is fully booked.');
            return res.redirect('/student/slots');
        }

        const sql = 'INSERT INTO bookings (slot_id, student_id, class_size, description, status) VALUES (?, ?, 1, ?, "pending")';
        db.query(sql, [slotId, studentId, description || null], (error) => {
            if (error) {
                console.error('Booking Error:', error);
                req.flash('error', 'Failed to book slot: ' + error.message);
            } else {
                req.flash('success', 'Slot booking requested! Pending teacher approval.');
            }
            res.redirect('/student/my-bookings');
        });
    });
});

app.get('/student/my-bookings', checkAuthenticated, checkStudent, (req, res) => {
    const sql = `
        SELECT b.*, ts.subject, ts.location, ts.slot_date, ts.slot_time, ts.end_time, t.full_name as teacher_name
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

function combineSlotDateTime(slotDate, slotTime) {
    const d = new Date(slotDate);
    const parts = String(slotTime).split(':').map(Number);
    d.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
    return d;
}

app.post('/student/bookings/:id/cancel', checkAuthenticated, checkStudent, (req, res) => {
    const reason = (req.body.reason || '').trim();
    if (!reason) {
        req.flash('error', 'Please provide a reason for cancelling.');
        return res.redirect('/student/my-bookings');
    }

    const checkSql = `
        SELECT b.status, ts.slot_date, ts.slot_time
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        WHERE b.booking_id = ? AND b.student_id = ?
    `;
    db.query(checkSql, [req.params.id, req.session.user.id], (checkError, results) => {
        if (checkError || results.length === 0) {
            req.flash('error', 'Booking not found.');
            return res.redirect('/student/my-bookings');
        }

        const booking = results[0];
        if (combineSlotDateTime(booking.slot_date, booking.slot_time) < new Date()) {
            req.flash('error', 'This session has already passed and cannot be cancelled.');
            return res.redirect('/student/my-bookings');
        }
        if (booking.status === 'cancelled' || booking.status === 'rejected') {
            req.flash('error', 'This booking cannot be cancelled.');
            return res.redirect('/student/my-bookings');
        }

        const sql = 'UPDATE bookings SET status = "cancelled", student_reason = ? WHERE booking_id = ? AND student_id = ?';
        db.query(sql, [reason, req.params.id, req.session.user.id], (error) => {
            if (error) req.flash('error', 'Failed to cancel booking.');
            else req.flash('success', 'Booking cancelled.');
            res.redirect('/student/my-bookings');
        });
    });
});

/// Tian le ///

app.get('/student/bookings/:id/edit', checkAuthenticated, checkStudent, (req, res) => {
    const sql = 'SELECT * FROM bookings WHERE booking_id = ? AND student_id = ? AND status = "pending"';
    db.query(sql, [req.params.id, req.session.user.id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'Booking not found or cannot be edited.');
            return res.redirect('/student/my-bookings');
        }
        res.render('student_booking_edit', { booking: results[0] });
    });
});
/// Jayden ///
app.post('/student/bookings/:id/edit', checkAuthenticated, checkStudent, (req, res) => {
    const { class_size, description } = req.body;
    const sql = 'UPDATE bookings SET class_size = ?, description = ? WHERE booking_id = ? AND student_id = ? AND status = "pending"';
    db.query(sql, [class_size, description || null, req.params.id, req.session.user.id], (error) => {
        if (error) {
            req.flash('error', 'Failed to update booking.');
            return res.redirect(`/student/bookings/${req.params.id}/edit`);
        }
        req.flash('success', 'Booking updated successfully.');
        res.redirect('/student/my-bookings');
    });
});

// Change booking to a different available slot — shows the picker page
app.get('/student/bookings/:id/change', checkAuthenticated, checkStudent, (req, res) => {
    const bookingSql = `
        SELECT b.*, ts.slot_date, ts.slot_time, ts.subject
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        WHERE b.booking_id = ? AND b.student_id = ?
    `;
    db.query(bookingSql, [req.params.id, req.session.user.id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'Booking not found.');
            return res.redirect('/student/my-bookings');
        }

        const booking = results[0];
        if (combineSlotDateTime(booking.slot_date, booking.slot_time) < new Date()) {
            req.flash('error', 'This session has already passed and cannot be changed.');
            return res.redirect('/student/my-bookings');
        }
        if (booking.status === 'cancelled' || booking.status === 'rejected') {
            req.flash('error', 'This booking cannot be changed.');
            return res.redirect('/student/my-bookings');
        }

        const slotsSql = `
            SELECT ts.*, t.full_name as teacher_name
            FROM teacher_slots ts
            JOIN teachers t ON ts.teacher_id = t.teacher_id
            WHERE ts.is_available = 1 AND ts.slot_id != ? AND ts.slot_date >= CURDATE()
            ORDER BY ts.slot_date, ts.slot_time
        `;
        db.query(slotsSql, [booking.slot_id], (slotsError, slots) => {
            res.render('student_booking_change', { booking, slots: slots || [] });
        });
    });
});

// Change booking to a different available slot — performs the update
app.post('/student/bookings/:id/change', checkAuthenticated, checkStudent, (req, res) => {
    const newSlotId = req.body.new_slot_id;
    const reason = (req.body.reason || '').trim();

    if (!newSlotId || !reason) {
        req.flash('error', 'Please select a new slot and provide a reason.');
        return res.redirect(`/student/bookings/${req.params.id}/change`);
    }

    const bookingSql = `
        SELECT b.*, ts.slot_date, ts.slot_time
        FROM bookings b
        JOIN teacher_slots ts ON b.slot_id = ts.slot_id
        WHERE b.booking_id = ? AND b.student_id = ?
    `;
    db.query(bookingSql, [req.params.id, req.session.user.id], (error, results) => {
        if (error || results.length === 0) {
            req.flash('error', 'Booking not found.');
            return res.redirect('/student/my-bookings');
        }

        const booking = results[0];
        if (combineSlotDateTime(booking.slot_date, booking.slot_time) < new Date()) {
            req.flash('error', 'This session has already passed and cannot be changed.');
            return res.redirect('/student/my-bookings');
        }
        if (booking.status === 'cancelled' || booking.status === 'rejected') {
            req.flash('error', 'This booking cannot be changed.');
            return res.redirect('/student/my-bookings');
        }

        const updateSql = `
            UPDATE bookings
            SET slot_id = ?, status = "pending", reject_reason = NULL, student_reason = ?
            WHERE booking_id = ? AND student_id = ?
        `;
        db.query(updateSql, [newSlotId, reason, req.params.id, req.session.user.id], (updateError) => {
            if (updateError) {
                req.flash('error', 'Failed to change booking.');
                return res.redirect(`/student/bookings/${req.params.id}/change`);
            }
            req.flash('success', 'Booking changed and sent for approval again.');
            res.redirect('/student/my-bookings');
        });
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
