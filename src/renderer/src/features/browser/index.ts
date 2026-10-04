/**
 * Punto de entrada del navegador integrado compartido (Code, Tareas y la ventana "Navegador"
 * aparte). Todo lo que hay aquí es agnóstico de producto: solo usa `window.api.browser`.
 */
export { BrowserPanel } from './BrowserPanel'
export type { BrowserPanelProps } from './BrowserPanel'
export { useNativeViewport } from './useNativeViewport'
export type { NativeViewportState } from './useNativeViewport'
export { br, onBrowser, hasBrowserBridge } from './bridge'
export {
  useBrowserUi,
  approvalsFor,
  ownerKey,
  sameOwner,
  isLikelyUrl,
  googleSearchUrl,
  toNavigationInput,
  hostOf,
  splitHostForDisplay,
  CARD_ARM_DELAY_MS,
  isCardArmed,
  armRemainingMs,
  approvalButtons,
  formatPageChatText,
  formatElementChatText
} from './store'
export { TabStrip } from './TabStrip'
export { UrlBar } from './UrlBar'
export { AgentBar } from './AgentBar'
export { Cards } from './Cards'
export { DevServerHint } from './DevServerHint'
export { ElementChipRow, ElementReadonlyChip } from './ElementChip'
export { ElementDetailPopover } from './ElementDetailPopover'
export { setPickState, isPicking, stopPicking } from './pick-state'
export {
  ELEMENT_MARKER,
  ELEMENT_METADATA,
  ELEMENT_TEXT_MAX,
  MAX_ELEMENTS,
  ELEMENT_IMAGE_NAME,
  elementLabel,
  shortSelector,
  hostOfUrl,
  diagnosticsCount,
  usableImage,
  defaultInclude,
  effectiveInclude,
  makeElementAttachment,
  isElementAttachment,
  addElementAttachment,
  formatElementContext,
  buildElementParts,
  elementPartsOf,
  isElementContextText,
  elementTextsOf,
  detailFromElement,
  parseElementContext
} from './element-context'
export type { ElementAttachment, ElementInclude, ElementDetail, ElementTextPart, ElementFilePart } from './element-context'
