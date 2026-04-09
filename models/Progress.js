const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: mongoose.Schema.Types.ObjectId,
  response: String,
  selfGrade: { type: String, enum: ['correct', 'partial', 'incorrect', null], default: null }
});

const progressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  problemSet: mongoose.Schema.Types.ObjectId,
  answers: [answerSchema],
  timeSpent: Number,     // seconds
  completed: { type: Boolean, default: false },
  completedAt: Date,
  startedAt: { type: Date, default: Date.now }
});

progressSchema.index({ user: 1, course: 1, problemSet: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
