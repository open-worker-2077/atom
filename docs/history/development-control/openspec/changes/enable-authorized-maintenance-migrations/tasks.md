## 1. Trusted capability propagation

- [x] 1.1 Add failing tests proving token-authenticated maintenance can move a Program-locked subtree while the same ordinary interaction remains denied.
- [x] 1.2 Propagate an internal trusted-maintenance option from authenticated admin/global CLI composition through the runtime executor and interaction runtime.
- [x] 1.3 Make the access controller bypass ordinary Graph authorization only when that internal option is present, without bypassing structural or transactional validation.

## 2. Verification and authorized migration

- [x] 2.1 Run focused runtime/security tests and strict OpenSpec validation.
- [x] 2.2 Execute the user-approved two-transaction hierarchy migration and verify top-level, destination subtrees, path rewrites, and healthy public read-back.
- [ ] 2.3 Run system/full regression, review the diff, commit, push, merge, deploy, and update Issue #1 evidence.
