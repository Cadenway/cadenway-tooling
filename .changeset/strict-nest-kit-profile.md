---
'@cadenway/nest-testing': minor
---

Add an opt-in strict Service Kit profile to the architecture verifier. Validate package exports,
dependency direction, private imports, and test leaks without building the kit. Check the runtime
boundaries for database request context and durable jobs, and retain the diagnostics and entry
points of the existing profiles.
