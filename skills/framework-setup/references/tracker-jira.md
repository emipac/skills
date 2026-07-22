adapter: jira

# Jira adapter

Use the connected Atlassian/Jira integration available to the client. Resolve
the cloud site, project key, issue types, workflow transitions, and link types
before the first write; record those resolved values in the project tracker
document when they differ from defaults.

Create the parent and implementation issues first, then add native blocking
links. Query open, unassigned issues with no open blockers for the frontier.
Claim by assignment and transition through the project's existing workflow;
never invent status or link names.
