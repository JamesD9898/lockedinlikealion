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

// Notes page — all problems with canvas work
router.get('/:slug/notes', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');

  const progressData = await Progress.find({
    user: req.session.user.id,
    course: course._id
  }).lean();

  const progressMap = {};
  progressData.forEach(p => {
    if (p.problemSet) progressMap[p.problemSet.toString()] = p;
  });

  // Build a flat list of all questions with their location
  const allQuestions = [];
  course.units.forEach((unit, ui) => {
    unit.problemSets.forEach((ps, si) => {
      const prog = progressMap[ps._id.toString()];
      ps.questions.forEach((q, qi) => {
        // Find grade for this question from progress answers
        let selfGrade = null;
        if (prog && prog.answers) {
          const a = prog.answers.find(a => a.questionId && a.questionId.toString() === q._id.toString());
          if (a) selfGrade = a.selfGrade;
        }
        allQuestions.push({
          qId: q._id.toString(),
          number: q.number || (qi + 1),
          text: q.text,
          unitTitle: unit.title,
          unitIndex: ui,
          setTitle: ps.title,
          setIndex: si,
          selfGrade,
          href: `/courses/${course.slug}/unit/${ui}/set/${si}?q=${qi}`
        });
      });
    });
  });

  res.render('notes', { course, allQuestions });
});

// JSON upload page
router.get('/:slug/upload', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');
  res.render('upload', { course });
});

// Practice / random mode
// ?units=0,1,2  (unit indices, omit for all units)
// ?type=all|problem_set|exam
router.get('/:slug/practice', async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).lean();
  if (!course) return res.status(404).render('404');

  const { units: unitsParam, type } = req.query;

  // Determine which unit indices to pull from
  let unitIndices;
  if (unitsParam) {
    unitIndices = unitsParam.split(',').map(Number).filter(n => !isNaN(n) && n < course.units.length);
  } else {
    unitIndices = course.units.map((_, i) => i);
  }

  // Gather all questions from selected units/sets
  const questions = [];
  unitIndices.forEach(ui => {
    const unit = course.units[ui];
    if (!unit) return;
    unit.problemSets.forEach(ps => {
      if (type && type !== 'all' && ps.type !== type) return;
      ps.questions.forEach(q => {
        questions.push({
          ...q,
          _source: { unitTitle: unit.title, setTitle: ps.title, unitIndex: ui }
        });
      });
    });
  });

  // Shuffle
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  // Build a synthetic problem set
  const practiceSet = {
    _id: 'practice-' + Date.now(),
    title: 'Practice Session',
    type: 'problem_set',
    timeLimit: null,
    questions
  };

  // Fake unit/indices for breadcrumb
  const unit = { title: unitIndices.length === course.units.length ? 'All Units' : unitIndices.map(i => `Unit ${i+1}`).join(', ') };

  res.render('problem-set', {
    course,
    unit,
    unitIndex: -1,
    setIndex: -1,
    problemSet: practiceSet,
    progress: null,
    practiceMode: true,
    selectedUnits: unitIndices
  });
});

module.exports = router;
