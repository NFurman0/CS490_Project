# ReviewLens UI/UX Standards

This document defines consistent visual and interaction patterns for ReviewLens.

AI coding tools: Follow these standards and existing project patterns; preserve the authentication and validation behaviors below.

---

## 1. Application navigation:

- Include the AnalysisTarget list and navigation on the left of all pages when the user is signed in, except the settings pages which should not include the AnalysisTarget navigation.

- Provide a clear button for creating an AnalysisTarget at the top of the AnalysisTarget navigation.

- Protected pages and actions require authentication; when a session is missing or expired, do not show protected content, and route the user through the established sign-in flow before returning them to their intended destination when supported.

- Buttons related to account settings should always be available in the top right.
  - If the user is signed out this means the sign-in button.
  - If the user is signed in this means a clickable button that opens a pop-up menu with options to visit the account settings or to sign out.

- The account settings page should group related settings into categories with a navigation on the left side. At the bottom this navigation should include a redundant sign-out button.

---

## 2. Page layout:

- Pages should use a consistent shell that has a left side navigation, a banner across the top (including the account buttons in the top right) and a focused main content area. The sizes of each of these areas should be consistent across every page on the website.

- CSS spacing must not use exact pixels, instead using scaling values like % or vw/vh.

- The AnalysisTarget list should show the user-entered name of each target and be sorted chronologically with the most recently accessed targets at the top. Until target workspace access tracking is implemented, use most recently created as the temporary ordering.

- All pages must be designed to keep necessary functionality visible on small monitors.

---

## 3. Form conventions:

- All inputs of the same type should be styled using the same css file (not including position), guaranteeing consistency across pages.

- Forms that don't take up the entire main content should dim the background slightly and use rounded corners (with this styling being consistent across all such forms).

- Each form should align its fields in the same way (left, right, or centered).

- Rarely used inputs should be hidden under an 'advanced options' dropdown. This dropdown should also reuse the same css file across every page.

- Each form should have a clear submit button (again following consistent styling across every page).

- Labels for inputs should always be directly above or directly left of the input (except radio buttons, where the label for each button should be directly right of the button). For a field with multiple inputs (like radio buttons or checkboxes) the title of that field should be one line above the inputs.

- Required fields should be denoted with an asterisk (*), unless they are the only field in the form in which case the submit button can simply be disabled (visibly) when the field is empty.

- Client side input validation for text fields should be performed on every keystroke, and display directly below the text input.

- AnalysisTarget creation must collect and validate all required target information, including a usable review-platform URL, before accepting or saving the target.

---

## 4. Validation and error presentation:

- Show field-specific validation below the affected input.

- Explain what is wrong and how to correct it with clear and helpful messages that do not rely on technical knowledge.

- Validate required AnalysisTarget information before acceptance.

- If ingestion input is invalid, unsupported, or unusable, show a meaningful message that identifies the problem; do not present the request as successful or leave the user with a silent failure.

- Avoid exposing sensitive implementation details in errors (adhere to the specifications in security-guardrails.md).

---

## 5. Loading and processing states:

- Spinners should be large and easily visible to the user. They should also show loading percentage whenever possible.

- Make pending work visible on the action and/or affected content, including AnalysisTarget creation and review aggregation.

- Prevent accidental duplicate submissions while a request is in progress by disabling the submit button.

- Display the success or failure immediately on completion.

---

## 6. Button and action conventions:

- Most forms should use an explicit submit button with consistent styling. Other buttons should not look the same as the submit button.

- Settings forms should **not** use a submit button, instead auto-saving every change for small actions and requesting confirmation on dramatic actions like deleting an account.

- Use specific action labels (for example, "Create target" or "Run analysis") instead of vague labels such as "Submit."

- Disable or otherwise guard actions when required input is invalid or a request is already in progress.

- Buttons should go off when the user releases their mouse (mouse up), not when they initially click (mouse down). If the user clicks down but then moves their mouse off the button before releasing the mouse, assume that they do not want to click the button.

---

## 7. Spacing and typography:

- Ordinary text should use a font size of 1em.

- All text should use a line height of 1.5 (unitless to scale with font size).

- Ordinary text should use a font family of Inter, Open Sans, Arial.

- The text hierarchy (titles, headings, ordinary text, captions) should be consistent across all pages.

- Use #F8F9FA as the primary background color instead of pure white.

- Use #000000 (black) as the primary text color.

- Use #1B56FD as the primary color for buttons and #184bd9 for the on-hover color.
- Use RGB(108, 117, 125) (#6C757D) as the background color for secondary buttons, with white text. On hover, use RGB(90, 98, 104) (#5A6268).

- Account for text wrapping on smaller monitors.

- For bodies of text use a max-width of 75ch and a min-width of 50ch to minimize eye strain.

---

## 8. Reusable component expectations:

- Attempt to reuse components for at least the page layout, page headings, forms and fields, buttons, status indicators, spinners, and error messages.

- Extend or reuse established components before introducing a one-off variation.
