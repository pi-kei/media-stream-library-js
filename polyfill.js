import { Buffer } from 'buffer'
window.Buffer = Buffer
import * as process from 'process/browser'
window.process = process
window.global = window
