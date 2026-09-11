# Stride formula language

Formulas are interpreted as expressions. JavaScript, property traversal, network access, and arbitrary code execution are unavailable. Each expression is limited to 2,000 characters, 300 tokens, and 40 nesting levels.

Use `prop("Property name")` to reference a row property. Primitive values remain text, numbers, booleans, or null; composite values currently become JSON text. Properties are resolved by the current database schema. Missing values become null.

Operators: `+ - * / %`, `== != < <= > >=`, `&& || !`, unary `+` and `-`, and parentheses. String `+` concatenates. Equality is strict. Numeric operations convert numeric strings; invalid or non-finite results are errors.

| Function | Example |
| --- | --- |
| Condition | `if(prop("Score") >= 80, "Ready", "Review")` |
| Arithmetic | `round(prop("Amount") * 1.13, 2)` |
| Aggregates | `sum(1, 2, 3)`, `average(2, 4)`, `min(2, 4)`, `max(2, 4)` |
| Absolute value | `abs(-5)` |
| Strings | `concat("Hello ", prop("Name"))`, `upper("hello")`, `lower("HELLO")` |
| Text checks | `length("Stride")`, `contains("Stride", "ride")`, `empty(prop("Note"))` |
| Dates | `dateadd("2026-09-06", 7)`, `datediff("2026-09-13", "2026-09-06")` |

Date differences are elapsed 24-hour days and can be fractional for timestamps. Date addition uses UTC calendar days. Division by zero and invalid dates report an error. Formula-property cycles are rejected by property evaluation.

Conditionals and boolean operators short-circuit. `if(false, 1 / 0, 1)` returns `1`; the unused branch does not read properties or calculate values. This language does not claim full Notion formula compatibility.
