# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-28

### Added

- Added explicit confirmation before executing repository-defined development or build tasks.
- Added multi-company regression coverage for process isolation, path confinement, log redaction, pagination, SVG sanitization, chat session grouping, and translation restoration.
- Added byte-based and line-based process log limits with automatic secret redaction.
- Added paginated loading for company issues and projects.

### Changed

- Moved task status and log operations to authenticated plugin actions scoped to the active company.
- Resolved project execution roots through the official primary workspace API instead of client-provided filesystem paths.
- Updated plugin capabilities to accurately declare issue, comment, project workspace, and state access.
- Updated local Paperclip SDK artifacts and made the build configuration portable across development machines.
- Changed bundled Paperclip dependencies to development-only dependencies so published packages remain installable.
- Changed chat session removal language and behavior to accurately represent browser-local hiding rather than server-side deletion.
- Replaced overlapping task and log polling intervals with completion-aware polling.
- Expanded planning leader selection to any eligible, invokable company agent instead of hard-coded identifiers.

### Fixed

- Fixed cross-company process, status, and log collisions caused by keys that did not include the company identifier.
- Fixed arbitrary execution-root injection by rejecting client-supplied root directories.
- Fixed workspace traversal through task working directories and symbolic links outside the authorized project root.
- Fixed detached processes remaining alive after plugin shutdown.
- Fixed concurrent task start, stop, and toggle races by serializing operations per company, project, and task type.
- Fixed unbounded process logs and oversized log entries that could exhaust worker memory.
- Fixed false-positive auto-save success states and overly aggressive focus restoration.
- Fixed stale translations overwriting application updates when translation was disabled.
- Fixed repeated canonical conversation generations being split into separate sessions.
- Fixed phantom empty chat sessions when the first canonical generation was not zero.
- Fixed partial cascade deletion from removing a parent after a child deletion failed.
- Fixed package exports, version metadata, dependency overrides, and release tarball installation.

### Security

- Sanitized remote and cached Iconify SVG content with strict element, attribute, URL, color, and size validation before DOM insertion.
- Restricted task execution to host-resolved project workspaces and validated real filesystem paths before reading task definitions or spawning processes.
- Scoped task process records and bridge actions to the authenticated company context.
- Redacted bearer tokens and common secret-bearing environment variables from retained process logs.
- Bounded the persistent Iconify cache by entry count and total size.
