## 📋 Lessons
- Ensure all variables are typed before pushing.
- **Improved Error Reporting**: When a resource (like an index or database) is missing, don't just say "Not found". Check if the file exists, if it's accessible, and if it's empty, and provide specific instructions for each case to help the user/agent troubleshoot.
- **Regex Precision**: In Dart parsing, use greedy matching `+` instead of non-greedy `+?` for headers like `extends` or `with` if you want to capture the entire list across multiple lines or including brackets, and ensure `[` and `]` are included in the character class for generic types.
