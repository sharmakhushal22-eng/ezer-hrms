// lib/pg-search.ts — building an `or=` filter out of something a person typed.
//
// Used by every screen with a person-search box: the ESS compose sheet, the
// admin inbox directory, the employee list, and the two wall composers. They
// all had the same bug, so they share the same fix.
//
// PostgREST's or() takes a comma-separated list of `column.op.value` terms, so
// `,` `.` `(` `)` and `:` inside the VALUE are read as more syntax. Interpolating
// a search box straight into it means a name with a comma in it does not return
// no matches — it returns a 400, and the screen above it has to guess why.
//
//   .or(`full_name.ilike.%${q}%,emp_code.ilike.%${q}%`)
//
//   q = "priya"       -> full_name.ilike.%priya%,emp_code.ilike.%priya%      ok
//   q = "Nair, Priya" -> full_name.ilike.%Nair, Priya%,emp_code.ilike.…      400
//                                              ^ parsed as the next term
//
// The fix PostgREST documents is to quote the value: inside double quotes the
// reserved characters are just characters. Only `"` and `\` have to be escaped
// once we are in there.
//
// `%` and `_` are deliberately NOT escaped. They are the SQL LIKE wildcards and
// they already behave that way on this screen today; making them literal would
// change what a search matches, which is a bigger decision than fixing a 400.
//
// The alternative already in the codebase (app/api/ess/funzone/route.ts) is to
// replace the offending characters with spaces. That never 400s, but it is
// lossy: "Nair, Priya" becomes "Nair  Priya", which then matches nobody,
// because the stored name still has the comma in it.

/** One `column.ilike."%term%"` term, safe for any user input. */
export function ilikeTerm(column: string, term: string): string {
  // Backslash first — escaping it after the quote would double-escape these.
  const value = `%${term}%`.replace(/[\\"]/g, m => `\\${m}`)
  return `${column}.ilike."${value}"`
}

/** The whole `or=` argument: the same term matched against several columns. */
export function orIlike(columns: string[], term: string): string {
  return columns.map(c => ilikeTerm(c, term)).join(',')
}
