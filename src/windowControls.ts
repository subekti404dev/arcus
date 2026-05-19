import { getCurrentWindow } from '@tauri-apps/api/window';

export async function minimizeWindow() {
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized();
  if (maximized) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
}

export async function closeWindow() {
  await getCurrentWindow().close();
}
