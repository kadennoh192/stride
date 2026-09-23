import type { Assignment, Course, GradeThreshold } from './types';

export const defaultThresholds: GradeThreshold[] = [
  { letter: 'A', minimum: 90 },
  { letter: 'B', minimum: 80 },
  { letter: 'C', minimum: 70 },
  { letter: 'D', minimum: 60 },
  { letter: 'F', minimum: 0 },
];

export function gradeLetter(percentage: number, thresholds: GradeThreshold[]) {
  return (
    [...thresholds]
      .sort((a, b) => b.minimum - a.minimum)
      .find((threshold) => percentage >= threshold.minimum)?.letter || '—'
  );
}

/** Averages only include actual scores, or explicitly entered expectations in projections. */
export function courseAverage(
  course: Course,
  assignments: Assignment[],
  projected = false,
): number | null {
  if (course.data.gradingMode === 'none') return null;
  const scored = assignments
    .filter(
      (assignment) =>
        !assignment.deleted && assignment.data.course === course.id,
    )
    .map((assignment) => ({
      assignment,
      score:
        assignment.data.score ??
        (projected ? assignment.data.expectedScore : null),
    }))
    .filter(
      (entry): entry is { assignment: Assignment; score: number } =>
        entry.score !== null &&
        Number.isFinite(entry.score) &&
        entry.assignment.data.possible > 0,
    );
  if (!scored.length) return null;
  if (course.data.gradingMode === 'points') {
    const possible = scored.reduce(
      (sum, entry) => sum + entry.assignment.data.possible,
      0,
    );
    return (
      (100 * scored.reduce((sum, entry) => sum + entry.score, 0)) / possible
    );
  }
  const mean = (items: typeof scored) =>
    items.reduce(
      (sum, entry) =>
        sum + (100 * entry.score) / entry.assignment.data.possible,
      0,
    ) / items.length;
  if (course.data.gradingMode === 'percent') return mean(scored);
  const categories = course.data.categories
    .map((category) => ({
      weight: category.weight,
      items: scored.filter(
        (entry) => entry.assignment.data.category === category.id,
      ),
    }))
    .filter((category) => category.items.length && category.weight > 0);
  const activeWeight = categories.reduce(
    (sum, category) => sum + category.weight,
    0,
  );
  if (!activeWeight) return null;
  return (
    categories.reduce(
      (sum, category) => sum + mean(category.items) * category.weight,
      0,
    ) / activeWeight
  );
}

export function assignmentSuggestions(level: string) {
  if (level === 'gradeSchool')
    return ['Homework', 'Quiz', 'Project', 'Reading'];
  if (level === 'university')
    return ['Essay', 'Lab', 'Midterm', 'Final', 'Problem set'];
  return ['Homework', 'Quiz', 'Test', 'Project', 'Essay'];
}
