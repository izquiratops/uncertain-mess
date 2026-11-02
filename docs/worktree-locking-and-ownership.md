# Why does the worktree manager use SQLite and JSON?

The worktree manager uses them for two different jobs:

- **SQLite locks** stop two operations from using the same issue, branch, or worktree path at the same time.
- **JSON files** remember which issue owns a worktree, even after the program stops.

## Why use a database for locks?

SQLite can make a lock that works even when two separate copies of the program are running. The manager does not use the SQLite databases to save worktree information.

For each request, it creates a separate lock for the issue ID, the branch, and the worktree path. If another operation is already using any of them, the request fails immediately rather than waiting. The manager sorts the lock names so requests take locks in the same order.

Each lock has a SQLite file in `.git/issue-to-pr/locks/`. The manager turns the resource name into a safe, consistent filename, so requests for the same resource use the same file. It opens the file and starts a SQLite write transaction to take the lock. If it cannot take every lock, it closes the connections it has already opened.

The lock lasts while the database connection is open. Closing the connection releases it. If the program crashes, the operating system releases it. The SQLite file can remain on disk afterward, but it does not mean the lock is still held.

`withWorktree` keeps the locks for the whole operation passed to it. `ensure` keeps them only while checking or creating the worktree. Use `withWorktree` when continuing to work in the worktree.

## What are “GC roots,” and why does `activeLocks` exist?

JavaScript cleans up objects it thinks the program no longer needs. “GC roots” are places it checks to decide whether an object is still reachable.

The `activeLocks` set keeps a reference to the open database connections while an operation is running. This stops JavaScript from cleaning them up too early, which could close the connections and release the locks. When the operation finishes, the manager removes the connections from the set and closes them.

## Why are JSON files needed too?

A lock only says **“someone is using this right now.”** Once released, it does not remember who used the worktree.

A JSON file says **“this worktree belongs to this issue.”** It records the issue ID, branch, and path under `.git/issue-to-pr/worktrees/`. The filename is based on the branch name. The file stays there after the operation finishes or the program stops.

Before reusing a worktree, the manager checks that the branch and path match the JSON record. This stops a different issue from accidentally taking it over. The manager writes the record before creating the worktree, so even if the program stops just after creation, the ownership is already recorded. If a record already exists, it must match the request.

The manager also checks whether the issue already has a record for a different branch or path. If it does, the request stops instead of creating a second worktree. If a record cannot be read or is missing required information, the manager stops rather than risk a conflict.

## Is this related to idempotency?

Yes. **Idempotency** means that repeating the same request has the same effect as doing it once.

If you request the same issue, branch, and path again, the manager reuses the existing worktree instead of creating another one. That makes retries safer, including after a restart.

If you request a different branch or path for the same issue, the manager reports a conflict instead of creating a second worktree. That is a related safeguard against conflicting requests.
