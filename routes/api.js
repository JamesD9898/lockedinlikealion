const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Progress = require('../models/Progress');
const { requireAuth } = require('./middleware');

router.use(requireAuth);

// Create a new course
router.post('/courses', async (req, res) => {
  try {
    const { title, description } = req.body;
    const course = await Course.create({
      title,
      description,
      units: [],
      createdBy: req.session.user.id
    });
    res.json({ ok: true, slug: course.slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload JSON content to a course (merge units)
router.post('/courses/:slug/upload', async (req, res) => {
  try {
    const course = await Course.findOne({ slug: req.params.slug });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const data = req.body;

    // Update course description if provided
    if (data.description) course.description = data.description;

    // Merge units
    if (data.units && Array.isArray(data.units)) {
      for (const unit of data.units) {
        const existingUnit = course.units.find(u => u.title === unit.title);
        if (existingUnit) {
          // Update existing unit
          if (unit.overview) existingUnit.overview = unit.overview;
          if (unit.order !== undefined) existingUnit.order = unit.order;
          if (unit.problemSets) {
            for (const ps of unit.problemSets) {
              const existingPs = existingUnit.problemSets.find(p => p.title === ps.title);
              if (existingPs) {
                Object.assign(existingPs, ps);
              } else {
                existingUnit.problemSets.push(ps);
              }
            }
          }
        } else {
          course.units.push(unit);
        }
      }
    }

    // Sort units and problem sets by order
    course.units.sort((a, b) => (a.order || 0) - (b.order || 0));
    course.units.forEach(u => {
      u.problemSets.sort((a, b) => (a.order || 0) - (b.order || 0));
    });

    await course.save();
    res.json({ ok: true, unitCount: course.units.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save progress / answers
router.post('/progress', async (req, res) => {
  try {
    const { courseId, problemSetId, answers, timeSpent, completed } = req.body;

    const update = {
      answers,
      timeSpent,
      completed: completed || false
    };
    if (completed) update.completedAt = new Date();

    const progress = await Progress.findOneAndUpdate(
      { user: req.session.user.id, course: courseId, problemSet: problemSetId },
      update,
      { upsert: true, new: true }
    );

    res.json({ ok: true, progress });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a course
router.delete('/courses/:slug', async (req, res) => {
  try {
    const course = await Course.findOneAndDelete({ slug: req.params.slug });
    if (!course) return res.status(404).json({ error: 'Not found' });
    await Progress.deleteMany({ course: course._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
