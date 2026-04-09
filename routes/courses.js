const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Progress = require('../models/Progress');
const { requireAuth } = require('./middleware');

router.use(requireAuth);

// Course listing
router.get('/', async (req, res) => {
  const courses = await Course.find().lean();
  const progressData = await Progress.find({ user: req.session.user.id }).lean();

  // Compute progress per course
  const courseData = courses.map(course => {
    const totalSets = course.units.reduce((sum, u) => sum + u.problemSets.length, 0);
    const completedSets = progressData.filter(p =>
      p.course.toString() === course._id.toString() && p.completed
    ).length;
    return {
      ...course,
      totalSets,
      completedSets,
      progress: totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0
    };
  });

  res.render('courses', { courses: courseData });
});

// Course detail - units view
router.get('/:slug', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');

  const progressData = await Progress.find({
    user: req.session.user.id,
    course: course._id
  }).lean();

  const progressMap = {};
  progressData.forEach(p => {
    progressMap[p.problemSet.toString()] = p;
  });

  res.render('course-detail', { course, progressMap });
});

// Unit overview
router.get('/:slug/unit/:unitIndex', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');

  const unitIdx = parseInt(req.params.unitIndex);
  const unit = course.units[unitIdx];
  if (!unit) return res.status(404).render('404');

  const progressData = await Progress.find({
    user: req.session.user.id,
    course: course._id
  }).lean();

  const progressMap = {};
  progressData.forEach(p => {
    progressMap[p.problemSet.toString()] = p;
  });

  res.render('unit', { course, unit, unitIndex: unitIdx, progressMap });
});

// Problem set / exam view
router.get('/:slug/unit/:unitIndex/set/:setIndex', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');

  const unitIdx = parseInt(req.params.unitIndex);
  const setIdx = parseInt(req.params.setIndex);
  const unit = course.units[unitIdx];
  if (!unit) return res.status(404).render('404');

  const problemSet = unit.problemSets[setIdx];
  if (!problemSet) return res.status(404).render('404');

  const progress = await Progress.findOne({
    user: req.session.user.id,
    course: course._id,
    problemSet: problemSet._id
  }).lean();

  res.render('problem-set', { course, unit, unitIndex: unitIdx, setIndex: setIdx, problemSet, progress });
});

// JSON upload page
router.get('/:slug/upload', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');
  res.render('upload', { course });
});

module.exports = router;
