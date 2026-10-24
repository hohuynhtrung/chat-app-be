const os = require("node:os");

const SHELLS = {
  win32: "Windows, shell cmd.exe",
  darwin: "macOS, shell zsh/bash",
  linux: "Linux, shell sh",
};

const getOsInfo = () => {
  const platfrom = os.platform();
  return `${SHELLS[platfrom] ?? platfrom} ${os.release()} ${os.arch()}`;
};

module.exports = { getOsInfo };
