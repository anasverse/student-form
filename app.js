const express = require('express');
const app = express();
const path = require('path');
const ejsMate = require('ejs-mate');
const methodOverride = require('method-override');
const ExpressError = require('./utils/ExpressError');
const catchAsync = require('./utils/catchAsync');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const {
  format,
  endOfMonth,
  addMonths,
  subMonths,
  compareAsc,
  parseISO,
} = require('date-fns');
const Student = require('./models/student');
const User = require('./models/user');
const Payment = require('./models/payment');
const { isLoggedIn, isAdmin } = require('./middleware');

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static('public'));

const mongoose = require('mongoose');
mongoose
  .connect('mongodb://localhost:27017/student-form')
  .then(() => {
    console.log('CONNECTION OPEN!!!');
  })
  .catch((err) => {
    console.log('OH NO ERROR!!!!');
    console.log(err);
  });

const sessionConfig = {
  secret: 'thisisnotagoodsecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};

app.use(session(sessionConfig));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(User.createStrategy());

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use(async (req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.user;
  res.locals.format = format;
  next();
});

app.get('/', (req, res) => {
  res.render('home');
});

app.get('/register', (req, res) => {
  res.render('user/register');
});

app.post(
  '/register',
  catchAsync(async (req, res) => {
    try {
      const { name, email, password } = req.body.user;
      const newUser = new User({
        name,
        email,
        role: 'student',
      });
      const registeredUser = await User.register(newUser, password);
      req.login(registeredUser, (err) => {
        if (err) return next(err);
        req.flash('success', 'User registered successfully');
        res.redirect('/student/apply');
      });
    } catch (e) {
      console.log(e);
      res.redirect('/error');
    }
  })
);

app.get('/login', (req, res) => {
  res.render('user/login');
});

app.post(
  '/login',
  passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login',
  }),
  catchAsync(async (req, res) => {
    if (req.user.role === 'admin') {
      res.redirect('/admin/dashboard');
    } else if (req.user.role === 'student') {
      const user = await req.user.populate('student');
      if (user.student.status === 1) {
        res.redirect('/student/payment');
      } else {
        res.redirect('/student/apply');
      }
    }
  })
);

app.get(
  '/logout',
  catchAsync(async (req, res) => {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect('/login');
    });
  })
);

app.get('/user/forgotpassword', (req, res) => {
  res.render('user/forgotpwd');
});

app.get(
  '/student/apply',
  isLoggedIn,
  catchAsync(async (req, res) => {
    const user = await User.findById(req.user._id);
    const student = await Student.findOne({ email: user.email });
    if (student) {
      res.render('student/application', { student });
    } else {
      res.render('student/application', { user });
    }
  })
);

app.post(
  '/student/apply',
  catchAsync(async (req, res) => {
    const user = await User.findById(req.user._id);
    const { fatherName, dob, gender, address, contactNumber } =
      req.body.student;
    const { name, email } = user;
    const newStudent = new Student({
      name,
      fatherName,
      contactNumber,
      email,
      dob,
      gender,
      address,
      status: 0,
    });
    newStudent.user = req.user._id;
    user.student = newStudent._id;
    await newStudent.save();
    await user.save();
    res.redirect('/student/payment');
  })
);

app.get(
  '/student/payment',
  catchAsync(async (req, res) => {
    const paymentData = await Payment.findOne({ email: req.user.email });
    res.render('student/payment', { paymentData });
  })
);

app.post(
  '/student/payment/totaldues',
  catchAsync(async (req, res) => {
    const paymentData = await Payment.findOne({ email: req.user.email });
    const months = paymentData.monthlyData.filter((n) => n.paid !== true);
    months.forEach((month) => {
      month.paid = true;
    });
    await paymentData.save();
    res.redirect('back');
  })
);

app.post(
  '/student/payment/currentdues',
  catchAsync(async (req, res) => {
    const paymentData = await Payment.findOne({ email: req.user.email });
    const months = paymentData.monthlyData.filter(
      (n) => n.endDate <= endOfMonth(new Date())
    );
    months.forEach((month) => {
      month.paid = true;
    });
    await paymentData.save();
    res.redirect('back');
  })
);

app.post(
  '/student/payment/month',
  catchAsync(async (req, res) => {
    const paymentData = await Payment.findOne({ email: req.user.email });
    const months = paymentData.monthlyData.filter(
      (n) => endOfMonth(new Date(req.body.month)) >= new Date(n.endDate)
    );
    months.forEach((month) => {
      month.paid = true;
    });
    await paymentData.save();
    res.redirect('back');
  })
);

app.post(
  '/student/payment/:id',
  catchAsync(async (req, res) => {
    const paymentData = await Payment.findOne({
      email: req.user.email,
    });
    const reqMonth = paymentData.monthlyData.findIndex(
      ({ _id }) => _id.toString() === req.params.id
    );
    if (reqMonth === 0) {
      paymentData.monthlyData[reqMonth].paid = true;
      paymentData.duesFrom = addMonths(
        paymentData.monthlyData[reqMonth].endDate,
        1
      );
    } else if (paymentData.monthlyData[reqMonth - 1].paid === true) {
      paymentData.monthlyData[reqMonth].paid = true;
      paymentData.duesFrom = addMonths(
        paymentData.monthlyData[reqMonth].endDate,
        1
      );
    }
    await paymentData.save();
    res.redirect('back');
  })
);

app.get(
  '/admin/dashboard',
  isAdmin,
  catchAsync(async (req, res, next) => {
    const students = await Student.find({});
    res.render('admin/index', { students });
  })
);

app.get(
  '/admin/dashboard/pending',
  isAdmin,
  catchAsync(async (req, res, next) => {
    const students = await Student.find({ status: 0 });
    res.render('admin/index', { students });
  })
);

app.get(
  '/admin/dashboard/accepted',
  isAdmin,
  catchAsync(async (req, res, next) => {
    const students = await Student.find({ status: 1 });
    res.render('admin/index', { students });
  })
);

app.get(
  '/admin/dashboard/rejected',
  isAdmin,
  catchAsync(async (req, res, next) => {
    const students = await Student.find({ status: -1 });
    res.render('admin/index', { students });
  })
);

app.get(
  '/admin/dashboard/passed',
  isAdmin,
  catchAsync(async (req, res, next) => {
    const students = await Student.find({ status: 2 });
    res.render('admin/index', { students });
  })
);

app.post(
  '/student/accept/:id',
  isAdmin,
  catchAsync(async (req, res) => {
    const student = await Student.findById(req.params.id);
    const monthlyData = [];
    for (let i = 0; i < 12; i++) {
      const endDate = endOfMonth(addMonths(new Date('2023-01-01'), i));
      const paid = false;
      const amount = 1000;
      monthlyData.push({ endDate, amount, paid });
    }

    const newPayment = new Payment({
      monthlyData,
      student: student._id,
      email: student.email,
    });
    student.status = 1;
    student.payment = newPayment._id;
    await newPayment.save();
    await student.save();
    res.redirect('back');
  })
);

app.post(
  '/student/reject/:id',
  isAdmin,
  catchAsync(async (req, res) => {
    const student = await Student.findById(req.params.id);
    student.status = -1;
    await student.save();
    res.redirect('back');
  })
);

app.post(
  '/student/passed/:id',
  isAdmin,
  catchAsync(async (req, res) => {
    const student = await Student.findById(req.params.id);
    student.status = 2;
    await student.save();
    res.redirect('back');
  })
);

app.all('*', (req, res, next) => {
  next(new ExpressError('Page not found', 404));
});

app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;
  if (!err.message) err.message = 'Something Went Wrong';
  res.status(statusCode).render('error', { err });
});

app.listen(3000, () => {
  console.log('Listening on port 3000');
});
