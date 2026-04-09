const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Login page (also the landing - no marketing fluff)
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/courses');
  res.render('login', { error: null, mode: 'login' });
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/courses');
  res.render('login', { error: null, mode: 'register' });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.render('login', { error: 'Wrong username or password', mode: 'login' });
    }
    req.session.user = { id: user._id, username: user.username };
    res.redirect('/courses');
  } catch (err) {
    res.render('login', { error: 'Something went wrong', mode: 'login' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
      return res.render('login', { error: 'Username required, password min 4 chars', mode: 'register' });
    }
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.render('login', { error: 'Username taken', mode: 'register' });
    }
    const user = await User.create({ username: username.toLowerCase(), password });
    req.session.user = { id: user._id, username: user.username };
    res.redirect('/courses');
  } catch (err) {
    res.render('login', { error: 'Something went wrong', mode: 'register' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
