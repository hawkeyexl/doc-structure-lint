import * as vscode from 'vscode';
import { lintDocument } from './index';

export function activate(context: vscode.ExtensionContext) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('doc-structure-lint');

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'markdown') {
                lintAndReport(event.document, diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'markdown') {
                lintAndReport(document, diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('doc-structure-lint.lintDocument', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                lintAndReport(editor.document, diagnosticCollection);
            }
        })
    );
}

async function lintAndReport(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    const filePath = document.uri.fsPath;
    const templatePath = vscode.workspace.getConfiguration('doc-structure-lint').get('templatePath', './templates.yaml');
    const template = vscode.workspace.getConfiguration('doc-structure-lint').get('template', 'default');

    try {
        const result = await lintDocument({ file: filePath, templatePath, template });
        const diagnostics: vscode.Diagnostic[] = [];

        result.errors.forEach((error) => {
            const range = new vscode.Range(
                document.positionAt(error.position.start.offset),
                document.positionAt(error.position.end.offset)
            );
            const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diagnostic);
        });

        diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
        vscode.window.showErrorMessage(`Linting failed: ${error.message}`);
    }
}

export function deactivate() {
    // Clean up resources if needed
}
