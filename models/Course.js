const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  number: Number,
  text: String,
  parts: [{
    label: String,       // e.g. "(a)", "(b)"
    text: String,
    points: Number,
    answer: String       // open-ended answer / solution
  }],
  answer: String,        // for single-part questions
  points: Number,
  imageUrl: String       // optional diagram/figure
});

const problemSetSchema = new mongoose.Schema({
  title: String,
  type: { type: String, enum: ['problem_set', 'exam'], default: 'problem_set' },
  timeLimit: Number,     // minutes, null = untimed
  questions: [questionSchema],
  order: Number
});

const unitSchema = new mongoose.Schema({
  title: String,
  overview: String,      // markdown-ish overview text
  order: Number,
  problemSets: [problemSetSchema]
});

const courseSchema = new mongoose.Schema({
  title: String,
  slug: { type: String, unique: true },
  description: String,
  units: [unitSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

// Auto-generate slug from title
courseSchema.pre('save', function(next) {
  if (this.isModified('title')) {
    this.slug = this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  next();
});

module.exports = mongoose.model('Course', courseSchema);
