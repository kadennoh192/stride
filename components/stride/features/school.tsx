'use client';
import { CoreItemActionSurface } from '../core-item-actions';
import { useMemo, useState } from 'react';
import { useStride } from '@/lib/stride/store';
import {
  assignmentSuggestions,
  courseAverage,
  defaultThresholds,
  gradeLetter,
} from '@/lib/stride/school';
import {
  uid,
  shiftDate,
  type Assignment,
  type Course,
  type GradeCategory,
  type GradeThreshold,
} from '@/lib/stride/types';
import { saveFile } from '@/lib/stride/storage';
import { downloadBlob, fileURL } from '@/lib/stride/files';
import { Modal } from '../primitives';
import { Field } from '../forms';

const levels = [
  ['gradeSchool', 'Grade school'],
  ['highSchool', 'High school'],
  ['university', 'University'],
  ['custom', 'Custom'],
] as const;
const blankCourse = (): Course['data'] => ({
  title: '',
  instructor: '',
  color: '#5268e8',
  term: '',
  targetGrade: null,
  gradingMode: 'none',
  categories: [],
  thresholds: defaultThresholds.map((threshold) => ({ ...threshold })),
});
const blankAssignment = (
  course: string,
  timezone: string,
): Assignment['data'] => ({
  title: '',
  course,
  type: 'Homework',
  description: '',
  priority: 4,
  status: 'To do',
  due: '',
  time: '',
  plannedStart: '',
  duration: 30,
  timezone,
  attachments: [],
  category: '',
  score: null,
  possible: 100,
  expectedScore: null,
  reminders: [],
  alarms: [],
  completedAt: '',
});

function CourseEditor({
  course,
  close,
}: {
  course?: Course;
  close: () => void;
}) {
  const store = useStride();
  const [data, setData] = useState<Course['data']>(
    course?.data || blankCourse(),
  );
  const [error, setError] = useState('');
  const set = <K extends keyof Course['data']>(
    key: K,
    value: Course['data'][K],
  ) => setData((previous) => ({ ...previous, [key]: value }));
  const updateCategory = (index: number, value: Partial<GradeCategory>) =>
    set(
      'categories',
      data.categories.map((category, i) =>
        i === index ? { ...category, ...value } : category,
      ),
    );
  const updateThreshold = (index: number, value: Partial<GradeThreshold>) =>
    set(
      'thresholds',
      data.thresholds.map((threshold, i) =>
        i === index ? { ...threshold, ...value } : threshold,
      ),
    );
  return (
    <Modal open title={course ? 'Edit course' : 'New course'} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void (
            course
              ? store.update(course, data, 'Updated course')
              : store.add('course', data, 'Added course')
          )
            .then(close)
            .catch((reason) => setError(String(reason)));
        }}
      >
        <div className="form-grid">
          <Field label="Course title" wide>
            <input
              required
              value={data.title}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>
          <Field label="Teacher or instructor">
            <input
              value={data.instructor}
              onChange={(event) => set('instructor', event.target.value)}
            />
          </Field>
          <Field label="Term">
            <input
              value={data.term}
              onChange={(event) => set('term', event.target.value)}
            />
          </Field>
          <Field label="Color">
            <input
              aria-label="Course color"
              type="color"
              value={data.color}
              onChange={(event) => set('color', event.target.value)}
            />
          </Field>
          <Field label="Target grade (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={data.targetGrade ?? ''}
              onChange={(event) =>
                set(
                  'targetGrade',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </Field>
          <Field label="Grading mode">
            <select
              value={data.gradingMode}
              onChange={(event) =>
                set(
                  'gradingMode',
                  event.target.value as Course['data']['gradingMode'],
                )
              }
            >
              <option value="none">No grade tracking</option>
              <option value="points">Points earned versus possible</option>
              <option value="percent">Simple assignment percentages</option>
              <option value="weighted">Weighted categories</option>
            </select>
          </Field>
        </div>
        {data.gradingMode === 'weighted' && (
          <section>
            <h3>Categories</h3>
            <p>
              Weights must total 100%. Current averages use only categories with
              graded work.
            </p>
            {data.categories.map((category, index) => (
              <div className="form-grid" key={category.id}>
                <Field label={`Category ${index + 1}`}>
                  <input
                    required
                    value={category.title}
                    onChange={(event) =>
                      updateCategory(index, { title: event.target.value })
                    }
                  />
                </Field>
                <Field label="Weight (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={category.weight}
                    onChange={(event) =>
                      updateCategory(index, {
                        weight: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    set(
                      'categories',
                      data.categories.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                set('categories', [
                  ...data.categories,
                  { id: crypto.randomUUID(), title: '', weight: 0 },
                ])
              }
            >
              Add category
            </button>
            <p aria-live="polite">
              Total weight:{' '}
              {data.categories.reduce(
                (sum, category) => sum + category.weight,
                0,
              )}
              %
            </p>
          </section>
        )}
        {data.gradingMode !== 'none' && (
          <section>
            <h3>Letter grade thresholds</h3>
            {data.thresholds.map((threshold, index) => (
              <div className="form-grid" key={index}>
                <Field label="Letter">
                  <input
                    required
                    value={threshold.letter}
                    onChange={(event) =>
                      updateThreshold(index, { letter: event.target.value })
                    }
                  />
                </Field>
                <Field label="Minimum (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={threshold.minimum}
                    onChange={(event) =>
                      updateThreshold(index, {
                        minimum: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    set(
                      'thresholds',
                      data.thresholds.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                set('thresholds', [
                  ...data.thresholds,
                  { letter: '', minimum: 0 },
                ])
              }
            >
              Add threshold
            </button>
          </section>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {course && (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => void store.remove(course).then(close)}
            >
              Delete course
            </button>
          )}
          <button className="primary-button">Save course</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignmentEditor({
  assignment,
  course,
  close,
}: {
  assignment?: Assignment;
  course: string;
  close: () => void;
}) {
  const store = useStride();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [data, setData] = useState<Assignment['data']>(
    assignment?.data ||
      blankAssignment(course, store.settings.timezone || 'UTC'),
  );
  const [error, setError] = useState('');
  const courses = store.entities.filter(
    (entity): entity is Course => entity.kind === 'course',
  );
  const selected = courses.find((item) => item.id === data.course);
  const set = <K extends keyof Assignment['data']>(
    key: K,
    value: Assignment['data'][K],
  ) => setData((previous) => ({ ...previous, [key]: value }));
  return (
    <Modal
      open
      title={assignment ? 'Edit assignment' : 'New assignment'}
      onClose={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void (async () => {
            const attachments = [...data.attachments];
            for (const file of pendingFiles) {
              const id = uid();
              await saveFile(id, file, store.owner, file.name);
              attachments.push({ id, name: file.name });
            }
            const updated = {
              ...data,
              plannedStart: data.status === 'Done' ? '' : data.plannedStart,
              attachments,
              completedAt:
                data.status === 'Done'
                  ? data.completedAt || new Date().toISOString()
                  : '',
            };
            if (assignment)
              await store.update(assignment, updated, 'Updated assignment');
            else await store.add('assignment', updated, 'Added assignment');
            void store.sync();
            close();
          })().catch((reason) => setError(String(reason)));
        }}
      >
        <div className="form-grid">
          <Field label="Assignment title" wide>
            <input
              required
              value={data.title}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>
          <Field label="Course">
            <select
              required
              value={data.course}
              onChange={(event) => {
                set('course', event.target.value);
                set('category', '');
              }}
            >
              {courses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.data.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <input
              list="assignment-types"
              value={data.type}
              onChange={(event) => set('type', event.target.value)}
            />
            <datalist id="assignment-types">
              {assignmentSuggestions(store.settings.educationLevel).map(
                (type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ),
              )}
            </datalist>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={data.due}
              onChange={(event) => set('due', event.target.value)}
            />
          </Field>
          <Field label="Due time">
            <input
              type="time"
              value={data.time}
              onChange={(event) => set('time', event.target.value)}
            />
          </Field>
          <Field label="Estimated duration (minutes)">
            <input
              type="number"
              min={1}
              max={10080}
              value={data.duration ?? 30}
              onChange={(event) => set('duration', Number(event.target.value))}
            />
          </Field>
          <Field label="Planned start">
            <input
              type="datetime-local"
              value={
                data.plannedStart
                  ? new Date(
                      Date.parse(data.plannedStart) -
                        new Date(data.plannedStart).getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ''
              }
              onChange={(event) =>
                set(
                  'plannedStart',
                  event.target.value
                    ? new Date(event.target.value).toISOString()
                    : '',
                )
              }
            />
          </Field>
          <Field label="Timezone">
            <input
              list="timezones"
              value={data.timezone}
              onChange={(event) => set('timezone', event.target.value)}
            />
          </Field>
          <Field label="Priority">
            <select
              value={data.priority}
              onChange={(event) => set('priority', Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={data.status}
              onChange={(event) =>
                set(
                  'status',
                  event.target.value as Assignment['data']['status'],
                )
              }
            >
              <option>To do</option>
              <option>In progress</option>
              <option>Done</option>
            </select>
          </Field>
          {selected?.data.gradingMode === 'weighted' && (
            <Field label="Grade category">
              <select
                value={data.category}
                onChange={(event) => set('category', event.target.value)}
              >
                <option value="">Choose category</option>
                {selected.data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {selected?.data.gradingMode !== 'none' && (
            <>
              <Field label="Points possible">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={data.possible}
                  onChange={(event) =>
                    set('possible', Number(event.target.value))
                  }
                />
              </Field>
              <Field label="Actual score">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={data.score ?? ''}
                  onChange={(event) =>
                    set(
                      'score',
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <Field label="Expected score for projection">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={data.expectedScore ?? ''}
                  onChange={(event) =>
                    set(
                      'expectedScore',
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
              </Field>
            </>
          )}
          <Field label="Description" wide>
            <textarea
              value={data.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>
          <Field label="Attachments" wide>
            <input
              type="file"
              multiple
              onChange={(event) =>
                setPendingFiles([
                  ...pendingFiles,
                  ...Array.from(event.target.files || []),
                ])
              }
            />
            <ul>
              {data.attachments.map((file) => (
                <li key={file.id}>
                  {file.name}
                  <button
                    type="button"
                    className="subtle-button"
                    onClick={async () => {
                      const url = await fileURL(file.id, store.owner);
                      const blob = await (await fetch(url)).blob();
                      downloadBlob(blob, file.name);
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className="subtle-button"
                    onClick={() =>
                      set(
                        'attachments',
                        data.attachments.filter((item) => item.id !== file.id),
                      )
                    }
                  >
                    Detach
                  </button>
                </li>
              ))}
              {pendingFiles.map((file, index) => (
                <li key={`${file.name}-${index}`}>{file.name} (new)</li>
              ))}
            </ul>
          </Field>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {assignment && (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => void store.remove(assignment).then(close)}
            >
              Delete assignment
            </button>
          )}
          <button className="primary-button">Save assignment</button>
        </div>
      </form>
    </Modal>
  );
}

export default function School({ targetId }: { targetId?: string }) {
  const store = useStride();
  const [view, setView] = useState<'list' | 'board' | 'calendar' | 'courses'>(
    'list',
  );
  const [courseFilter, setCourseFilter] = useState('');
  const [editingCourse, setEditingCourse] = useState<Course | 'new' | null>(
    () =>
      (store.entities.find(
        (entity) => entity.id === targetId && entity.kind === 'course',
      ) as Course | undefined) || null,
  );
  const [editingAssignment, setEditingAssignment] = useState<
    Assignment | 'new' | null
  >(
    () =>
      (store.entities.find(
        (entity) => entity.id === targetId && entity.kind === 'assignment',
      ) as Assignment | undefined) || null,
  );
  const courses = store.entities.filter(
    (entity): entity is Course => entity.kind === 'course',
  );
  const assignments = store.entities.filter(
    (entity): entity is Assignment => entity.kind === 'assignment',
  );
  const visible = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            !courseFilter || assignment.data.course === courseFilter,
        )
        .sort(
          (a, b) =>
            (a.data.due || '9999').localeCompare(b.data.due || '9999') ||
            a.data.priority - b.data.priority,
        ),
    [assignments, courseFilter],
  );
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const overdue = visible.filter(
    (assignment) =>
      assignment.data.due &&
      assignment.data.due < today &&
      assignment.data.status !== 'Done',
  ).length;
  const upcoming = visible.filter(
    (assignment) =>
      assignment.data.due >= today &&
      assignment.data.due <= shiftDate(today, 7) &&
      assignment.data.status !== 'Done',
  ).length;
  const row = (assignment: Assignment) => (
    <CoreItemActionSurface
      key={assignment.id}
      entity={assignment}
      onOpen={() => setEditingAssignment(assignment)}
    >
      {(menu) => (
        <div className="core-item-row">
          <button
            key={assignment.id}
            className="search-result"
            onClick={() => setEditingAssignment(assignment)}
          >
            <span>
              <strong>{assignment.data.title}</strong> ·{' '}
              {courses.find((course) => course.id === assignment.data.course)
                ?.data.title || 'Course removed'}
            </span>
            <small>
              {assignment.data.due || 'No due date'} · {assignment.data.status}
              {assignment.data.score !== null
                ? ` · ${assignment.data.score}/${assignment.data.possible}`
                : ''}
            </small>
          </button>
          {menu}
        </div>
      )}
    </CoreItemActionSurface>
  );
  if (!store.settings.schoolSetup)
    return (
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHOOL PLANNER</div>
          <h1>Set up School</h1>
          <p>
            Choose labels and assignment suggestions. You can change this later
            without changing grades or records.
          </p>
          <div className="form-actions">
            {levels.map(([value, label]) => (
              <button
                key={value}
                className="secondary-button"
                onClick={() =>
                  void store.setSettings({
                    educationLevel: value,
                    schoolSetup: true,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHOOL PLANNER</div>
          <h1>School</h1>
          <p>
            {overdue} overdue · {upcoming} due in the next seven days
          </p>
        </div>
        <div className="form-actions">
          <button
            className="secondary-button"
            onClick={() => setEditingCourse('new')}
          >
            New course
          </button>
          <button
            className="primary-button"
            disabled={!courses.length}
            onClick={() => setEditingAssignment('new')}
          >
            New assignment
          </button>
        </div>
      </div>
      <div className="calendar-toolbar">
        <label>
          Course{' '}
          <select
            value={courseFilter}
            onChange={(event) => setCourseFilter(event.target.value)}
          >
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.data.title}
              </option>
            ))}
          </select>
        </label>
        {(['list', 'board', 'calendar', 'courses'] as const).map((key) => (
          <button
            key={key}
            className={view === key ? 'primary-button' : 'secondary-button'}
            onClick={() => setView(key)}
          >
            {key[0].toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>
      {view === 'list' && (
        <div className="search-results">
          {visible.map(row)}
          {!visible.length && <p>No assignments yet.</p>}
        </div>
      )}
      {view === 'board' && (
        <div className="school-board">
          {(['To do', 'In progress', 'Done'] as const).map((status) => (
            <section key={status} className="school-column">
              <h2>{status}</h2>
              {visible
                .filter((assignment) => assignment.data.status === status)
                .map(row)}
            </section>
          ))}
        </div>
      )}
      {view === 'calendar' && (
        <div className="search-results">
          {visible.filter((assignment) => assignment.data.due).map(row)}
          {!visible.some((assignment) => assignment.data.due) && (
            <p>No dated assignments yet.</p>
          )}
        </div>
      )}
      {view === 'courses' && (
        <div className="school-board">
          {courses
            .filter((course) => !courseFilter || course.id === courseFilter)
            .map((course) => {
              const current = courseAverage(course, assignments);
              const projected = courseAverage(course, assignments, true);
              return (
                <section className="school-column" key={course.id}>
                  <h2>
                    <i
                      className="project-dot"
                      style={{ background: course.data.color }}
                    />{' '}
                    {course.data.title}
                  </h2>
                  <p>
                    {course.data.instructor}{' '}
                    {course.data.term && `· ${course.data.term}`}
                  </p>
                  <p>
                    Current:{' '}
                    {current === null
                      ? 'No graded work'
                      : `${current.toFixed(1)}% (${gradeLetter(current, course.data.thresholds)})`}
                  </p>
                  <p>
                    Projected:{' '}
                    {projected === null
                      ? 'No scores or expectations'
                      : `${projected.toFixed(1)}%`}
                  </p>
                  <p>
                    Target:{' '}
                    {course.data.targetGrade === null
                      ? 'Not set'
                      : `${course.data.targetGrade}%`}
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => setEditingCourse(course)}
                  >
                    Edit course
                  </button>
                </section>
              );
            })}
        </div>
      )}
      {editingCourse && (
        <CourseEditor
          course={editingCourse === 'new' ? undefined : editingCourse}
          close={() => {
            setEditingCourse(null);
            if (targetId) location.assign('#school');
          }}
        />
      )}
      {editingAssignment && (
        <AssignmentEditor
          assignment={
            editingAssignment === 'new' ? undefined : editingAssignment
          }
          course={courseFilter || courses[0]?.id || ''}
          close={() => {
            setEditingAssignment(null);
            if (targetId) location.assign('#school');
          }}
        />
      )}
    </>
  );
}
