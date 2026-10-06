# Release checklist

Version: 0.1.0. Publisher ID: `Edd` (display name: Edward Movsesyan). Extension identifier: `Edd.codex-usage`. Intended source repository: https://github.com/EdwardMovsesyan91/codex-usage.

## Local preparation completed

- MIT license, public README, changelog, metadata, and Git/package exclusion rules.
- Source and build audit: no unresolved secret or personal-path findings.
- TypeScript build and 25 tests pass using the existing development dependencies.
- Official @vscode/vsce 4.0.0 packages the local release candidate without warning overrides.
- `codex-usage-0.1.0-release-candidate.vsix` contains six runtime JavaScript files, package manifest, README, changelog, license, and the two required VSIX metadata entries.
- No tests, source maps, generated protocol files, development dependencies, or diagnostic artifacts are packaged.
- Codex app-server command, RPC lifecycle, usage calculations, commands and UI behavior are preserved. Release changes to runtime code only improve diagnostic privacy.

The earlier candidate contains an explicit publisher placeholder and must not be published. The final package with the confirmed publisher is `codex-usage-0.1.0.vsix`; inspect it after packaging and before publishing.

## Prerequisites still needed

1. Marketplace publisher ID `Edd` has been confirmed by the maintainer and set in package.json. Marketplace authentication is still required.
2. Git author identity is configured locally from the maintainer's supplied values. No credentials are stored in Git configuration.
3. Install GitHub CLI and authenticate outside the restricted execution environment:

```powershell
winget install --id GitHub.cli --exact
```

Restart the terminal if needed, then:

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth status
```

4. Run a fresh dependency install in an environment with access to npm. The local sandbox denied npm network access, so a clean install has not been verified here.

## Final checks and initial public commit

After metadata and prerequisites are complete:

```sh
npm install
npm test
npm run audit:release
npm run check:release
vsce package --out codex-usage-0.1.0.vsix
```

Inspect the final archive again for exactly the expected runtime files and public metadata. Review the staged files for private data. Only then configure the approved public commit author, stage the reviewed state and create the initial commit:

```sh
git add --all
git commit -m "chore: prepare initial public release"
git branch -M main
gh repo create EdwardMovsesyan91/codex-usage --public --source=. --remote=origin --push
```

If the repository already exists, inspect it before setting origin or pushing. Do not force push, overwrite history, or replace an existing remote without checking it.

The repository metadata identifies the intended destination; public repository existence has not yet been verified.

## Marketplace publisher and authentication

Create or manage the publisher at https://marketplace.visualstudio.com/manage. Choose **Create publisher**, set its ID and display name, and send only the publisher ID to the maintainer. Never paste access tokens into issues, chats, or repository files.

Microsoft recommends Microsoft Entra ID publishing with workload identity federation/managed identity. Grant the publishing identity access to the Marketplace publisher and authenticate it through the approved external identity workflow. Once configured, use the official command:

```sh
vsce publish --azure-credential --packagePath codex-usage-0.1.0.vsix
```

The authenticated identity must be authorized for the publisher. Entra ID setup depends on the account/tenant and cannot be assumed to exist. See the current official guide for identity authorization and secure automated publishing:

https://code.visualstudio.com/api/working-with-extensions/publishing-extension

No credentials are stored in this project. Do not use secret-scanning, repository, or license bypass flags. Do not publish the placeholder candidate.

## After publishing

Verify the GitHub repository, Marketplace identifier `<publisher-id>.codex-usage`, version 0.1.0, final VSIX filename, and a clean Git working tree. Update installation text/changelog to reflect actual publication rather than announcing a release in advance.
