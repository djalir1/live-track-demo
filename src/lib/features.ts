// Feature switches. Flip to true to bring a feature back; the code behind
// each switch is kept intact.

// Parent experience + school attendance (students, parents, attendants, trip
// lists, /parent, /family, /bus). ON on the feat/school-attendance branch;
// production (main) keeps it off until the attendance migrations are applied.
export const PARENTS_ENABLED = true;
