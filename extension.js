const { lstatSync, writeFile } = require('fs');
const _ = require('lodash');
const path = require('path');
const vscode = require('vscode');

const CONFIGURATIONS = {
  key: 'dartBarrelFileGenerator',
  values: {
    EXCLUDE_FREEZED: 'excludeFreezed',
    EXCLUDE_GENERATED: 'excludeGenerated',
  },
};

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Generate Current
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dart-barrel-file-generator.generateCurrent',
      generateCurrent
    )
  );

  // Generate Current and Nested
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dart-barrel-file-generator.generateCurrentAndNested',
      generateCurrentAndNested
    )
  );
}

/**
 * @param {vscode.Uri} uri
 */
async function generateCurrent(uri) {
  try {
    vscode.window.showInformationMessage(
      'GDBF: Generated file!',
      await validateAndGenerate(uri, false)
    );
  } catch (error) {
    vscode.window.showErrorMessage('GDBF: Error on generating the file', error);
  }
}

/**
 * @param {vscode.Uri} uri
 */
async function generateCurrentAndNested(uri) {
  try {
    vscode.window.showInformationMessage(
      'GDBF: Generated files!',
      await validateAndGenerate(uri, true)
    );
  } catch (error) {
    vscode.window.showErrorMessage('GDBF: Error on generating the file', error);
  }
}

/**
 * @param {vscode.Uri} uri
 * @param {boolean} recursive
 * @returns {Promise<string>}
 * @throws {Error}
 */
async function validateAndGenerate(uri, recursive = false) {
  let targetDir;
  if (_.isNil(_.get(uri, 'path'))) {
    targetDir = await getFolderNameFromInput();

    targetDir = toPosixPath(targetDir);

    if (!lstatSync(targetDir).isDirectory()) {
      throw Error('Select a directory!');
    }
  } else {
    if (!lstatSync(toPosixPath(uri.fsPath)).isDirectory()) {
      throw Error('Select a directory!');
    }

    targetDir = toPosixPath(uri.fsPath);
  }

  const currDir = toPosixPath(vscode.workspace.workspaceFolders[0].uri.fsPath);
  if (!targetDir.includes(currDir)) {
    throw Error('Select a folder from the workspace');
  } else {
    return generate(targetDir, recursive);
  }
}

/**
 * @param {string} targetPath Has to be in posix style
 * @param {boolean} recursive Whether it should be recursive
 * @param {string} appendToDir Appends the string to the directory name
 * @returns {Promise<string>}
 * @throws {Error}
 */
async function generate(targetPath, recursive = false, appendToDir = null) {
  // Selected target is in the current workspace
  // This could be optional
  const splitDir = targetPath.split('/');
  // The folder name
  const dirName = splitDir[splitDir.length - 1];
  // The folder name appended to all the folders that have been called since the
  // beggining of the recursion. It prevents adding files from folders which
  // are named the same
  const appendedDirName = appendToDir
    ? `${appendToDir}${path.sep}${dirName}`
    : dirName;

  const wksFiles = await vscode.workspace.findFiles(
    `**${path.sep}${appendedDirName}${path.sep}**`
  );

  const files = [];
  const dirs = new Set();

  for (const t of wksFiles) {
    const posixPath = toPosixPath(t.fsPath);
    if (lstatSync(posixPath).isFile()) {
      if (shouldExport(posixPath, dirName)) {
        if (posixPath.split(`/`).length - splitDir.length == 1) {
          // Get only dart files that are nested to the current folder
          files.push(posixPath.substring(posixPath.lastIndexOf('/') + 1));
        } else if (recursive) {
          // Get all subfolders since we want to create it recursively
          const targetFilePathParts = posixPath.split(targetPath);
          if (targetFilePathParts.length > 1) {
            const targetFileFolderParts = targetFilePathParts[1].split('/');
            if (targetFileFolderParts.length > 1) {
              const folderName = targetFileFolderParts[1];
              dirs.add(targetPath.concat(`/${folderName}`));
            }
          }
        }
      }
    }
  }

  if (recursive && dirs.size > 0) {
    for (const d of dirs) {
      files.push(
        toPosixPath(await generate(d, true, appendedDirName)).split(
          `${targetPath}/`
        )[1]
      );
    }
  }

  // Sort files
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let exports = '';

  for (const t of files) {
    exports = `${exports}export '${t}';\n`;
  }

  const barrelFile = `${targetPath}/${dirName}.dart`;
  return new Promise(async (resolve) => {
    writeFile(toPlatformSpecificPath(barrelFile), exports, 'utf8', (error) => {
      if (error) {
        throw Error(error.message);
      }

      resolve(toPlatformSpecificPath(barrelFile));
    });
  });
}

/**
 * @returns {Promise<string>}
 */
async function getFolderNameFromInput() {
  const checkboxOptions = {
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: 'Select the folder in which you want to create the barrel file',
  };

  return vscode.window.showOpenDialog(checkboxOptions).then((uri) => {
    if (_.isNil(uri) || _.isEmpty(uri)) {
      return undefined;
    }

    // The selected input is in the first array position
    return uri[0].path;
  });
}

/**
 * @param {string} pathLike
 * @returns {string}
 */
function toPosixPath(pathLike) {
  return pathLike.split(path.sep).join(path.posix.sep);
}

/**
 * @param {string} posixPath
 * @returns {string}
 */
function toPlatformSpecificPath(posixPath) {
  return posixPath.split(path.posix.sep).join(path.sep);
}

/**
 * @param {string} posixPath
 * @param {string} dirName
 * @returns {boolean} Whether the file should be exported or not
 */
function shouldExport(posixPath, dirName) {
  if (posixPath.endsWith('.dart') && !posixPath.endsWith(`${dirName}.dart`)) {
    if (posixPath.endsWith('.freezed.dart')) {
      // Export only if files are not excluded
      return !getConfig(CONFIGURATIONS.values.EXCLUDE_FREEZED);
    } else if (posixPath.endsWith('.g.dart')) {
      // Export only if files are not excluded
      return !getConfig(CONFIGURATIONS.values.EXCLUDE_GENERATED);
    }

    return true;
  }

  return false;
}

/**
 * @param {string} value
 * @returns {any} The value of the configuration (undefined if does not exist)
 */
function getConfig(value) {
  return vscode.workspace
    .getConfiguration()
    .get([CONFIGURATIONS.key, value].join('.'));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  generateCurrent,
  generateCurrentAndNested,
  validateAndGenerate,
  generate,
  toPosixPath,
  toPlatformSpecificPath,
};
