/**
 * ic_ds_* glyphs vendored from @deepseek-ai/dsh-client-ui-primitives
 * (src/icons/index.tsx, same figma source as the host's icon set) so the
 * plugin's client bundle stays self-contained per the dsh client-bundle
 * contract — only react and dsh-client-runtime/client are runtime-external;
 * importing the host package root would drag its CSS modules into the
 * inlined bundle. Re-sync these three paths if the host icon set redesigns
 * them; scripts/verify.mjs pins the path data.
 *
 * 2026-09-01 critique round: seven more ic_ds glyphs vendored (play/plus/
 * trash/refresh/globe/goal/warning) plus plugin-original learning-domain
 * companions (lock/star/book/crown/bolt/power/pin/flame) drawn in the same
 * language — those are NOT ic_ds, see their section comment below.
 * @module dsh-plugin-lookatstudy/client/icons
 */

import { createElement } from 'react'

/** Shared props for every vendored glyph (mirrors the host's IconProps). */
interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number
  /** Extra class for layout placement; color rides currentColor. */
  className?: string
}

/** ic_ds_think_outline_16 */
export function IconThinkOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', {
      d: 'M8.00192 6.64454C8.75026 6.64454 9.35732 7.25169 9.35739 8.00001C9.35739 8.74838 8.7503 9.35548 8.00192 9.35548C7.25367 9.35533 6.64743 8.74829 6.64743 8.00001C6.6475 7.25178 7.25371 6.64468 8.00192 6.64454Z',
      fill: 'currentColor',
    }),
    createElement('path', {
      'fill-rule': 'evenodd',
      'clip-rule': 'evenodd',
      d: 'M9.97165 1.29981C11.5853 0.718916 13.271 0.642197 14.3144 1.68555C15.3577 2.72902 15.2811 4.41466 14.7002 6.02833C14.4707 6.66561 14.1504 7.32937 13.75 8.00001C14.1504 8.67062 14.4707 9.33444 14.7002 9.97169C15.2811 11.5854 15.3578 13.271 14.3144 14.3145C13.271 15.3579 11.5854 15.2811 9.97165 14.7002C9.3344 14.4708 8.67059 14.1505 7.99997 13.75C7.32933 14.1505 6.66558 14.4708 6.02829 14.7002C4.41461 15.2811 2.72899 15.3578 1.68552 14.3145C0.642155 13.271 0.71887 11.5854 1.29977 9.97169C1.52915 9.33454 1.84865 8.67049 2.24899 8.00001C1.84866 7.32953 1.52915 6.66544 1.29977 6.02833C0.718852 4.41459 0.64207 2.729 1.68552 1.68555C2.72897 0.642112 4.41456 0.718887 6.02829 1.29981C6.66541 1.52918 7.32949 1.8487 7.99997 2.24903C8.67045 1.84869 9.33451 1.52919 9.97165 1.29981ZM12.9404 9.2129C12.4391 9.893 11.8616 10.5681 11.2148 11.2149C10.568 11.8616 9.89296 12.4391 9.21286 12.9404C9.62532 13.1579 10.0271 13.338 10.4121 13.4766C11.9146 14.0174 12.9172 13.8738 13.3955 13.3955C13.8737 12.9173 14.0174 11.9146 13.4765 10.4121C13.3379 10.0271 13.1578 9.62535 12.9404 9.2129ZM3.05856 9.2129C2.84121 9.62523 2.66197 10.0272 2.52341 10.4121C1.98252 11.9146 2.12627 12.9172 2.60446 13.3955C3.08278 13.8737 4.08544 14.0174 5.58786 13.4766C5.97264 13.338 6.37389 13.1577 6.7861 12.9404C6.10624 12.4393 5.43168 11.8614 4.78513 11.2149C4.13823 10.5679 3.55992 9.89313 3.05856 9.2129ZM7.99899 3.792C7.23179 4.31419 6.45306 4.95512 5.70407 5.70411C4.95509 6.45309 4.31415 7.23184 3.79196 7.99903C4.3143 8.76666 4.95471 9.54653 5.70407 10.2959C6.45309 11.0449 7.23271 11.6848 7.99997 12.207C8.76725 11.6848 9.54683 11.0449 10.2959 10.2959C11.0449 9.54686 11.6848 8.76729 12.207 8.00001C11.6848 7.23275 11.0449 6.45312 10.2959 5.70411C9.5465 4.95475 8.76662 4.31434 7.99899 3.792ZM5.58786 2.52344C4.08533 1.98255 3.08272 2.12625 2.60446 2.6045C2.12621 3.08275 1.98252 4.08536 2.52341 5.5879C2.66189 5.97253 2.8414 6.37409 3.05856 6.78614C3.55983 6.10611 4.1384 5.43189 4.78513 4.78516C5.43186 4.13843 6.10606 3.55987 6.7861 3.0586C6.37405 2.84144 5.97249 2.66192 5.58786 2.52344ZM13.3955 2.6045C12.9172 2.12631 11.9146 1.98257 10.4121 2.52344C10.0272 2.66201 9.62519 2.84125 9.21286 3.0586C9.8931 3.55996 10.5679 4.13827 11.2148 4.78516C11.8614 5.43172 12.4392 6.10627 12.9404 6.78614C13.1577 6.37393 13.338 5.97267 13.4765 5.5879C14.0174 4.08549 13.8736 3.08281 13.3955 2.6045Z',
      fill: 'currentColor',
    }))
}

/** ic_ds_loading_outline_16 */
export function IconLoadingOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', {
      d: 'M2.871 13.1286C0.0387669 10.2962 0.0387669 5.70383 2.871 2.87141C5.70341 0.0390029 10.2957 0.0391154 13.1282 2.87141L12.1387 3.86094C9.85292 1.57538 6.1469 1.57596 3.86123 3.86163C1.57573 6.14732 1.57573 9.85269 3.86123 12.1384C6.1469 14.424 9.85292 14.4246 12.1387 12.1391L13.1282 13.1286C10.2957 15.9609 5.70341 15.961 2.871 13.1286Z',
      fill: 'currentColor',
    }))
}

/** ic_ds_download_outline_16 */
export function IconDownloadOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', {
      d: 'M15.3695 11.411L15.1234 12.8866C14.8869 14.3042 13.6603 15.3436 12.223 15.3436H3.77673C2.33958 15.3434 1.1128 14.3042 0.876343 12.8866L0.630249 11.411L2.05408 11.1747L2.29919 12.6493C2.41973 13.3713 3.04475 13.9001 3.77673 13.9003H12.223C12.9551 13.9002 13.58 13.3713 13.7006 12.6493L13.9457 11.1747L15.3695 11.411ZM8.72205 8.994C8.77717 8.93934 8.83792 8.88106 8.90271 8.81627L12.4828 5.23424L13.5043 6.25572L9.92224 9.8358C9.6395 10.1185 9.38763 10.3732 9.15857 10.5575C8.91892 10.7503 8.63953 10.9224 8.2865 10.9784C8.09711 11.0083 7.90363 11.0083 7.71423 10.9784C7.36106 10.9224 7.0809 10.7503 6.84119 10.5575C6.61215 10.3732 6.36022 10.1185 6.07751 9.8358L2.49646 6.25572L3.51697 5.23424L7.09705 8.81627C7.16219 8.88142 7.22331 8.94006 7.27869 8.99498V1.3065H8.72205V8.994Z',
      fill: 'currentColor',
    }))
}

/** Vendored 2026-09-01 for the critique icon round (same figma source as the three above). */
/** IconPlayOutline16 */
export function IconPlayOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M14.1446 8C14.1446 4.6062 11.3938 1.85539 8 1.85539C4.6062 1.85539 1.85539 4.6062 1.85539 8C1.85539 11.3938 4.6062 14.1446 8 14.1446C11.3938 14.1446 14.1446 11.3938 14.1446 8ZM15.511 8C15.511 12.148 12.148 15.511 8 15.511C3.85202 15.511 0.489014 12.148 0.489014 8C0.489014 3.85202 3.85202 0.489014 8 0.489014C12.148 0.489014 15.511 3.85202 15.511 8Z', fill: 'currentColor' }),
    createElement('path', { d: 'M10.5617 8.42578C10.852 8.21614 10.852 7.78386 10.5617 7.57422L7.25708 5.18751C6.90974 4.93666 6.42436 5.18484 6.42436 5.61329V10.3867C6.42436 10.8152 6.90974 11.0633 7.25708 10.8125L10.5617 8.42578Z', fill: 'currentColor' }))
}

/** IconPlusOutline16 */
export function IconPlusOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z', fill: 'currentColor' }))
}

/** IconTrashOutline16 */
export function IconTrashOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z', fill: 'currentColor' }))
}

/** IconRefreshOutline16 */
export function IconRefreshOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z', fill: 'currentColor' }))
}

/** IconGlobeOutline14 */
export function IconGlobeOutline14({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z', fill: 'currentColor' }))
}

/** IconGoalOutline16 */
export function IconGoalOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M8 0C8.31451 0 8.62464 0.019379 8.92969 0.0546875C8.48228 0.403371 8.0952 0.825758 7.78809 1.30469C4.18586 1.41664 1.2998 4.37061 1.2998 8C1.2998 11.7003 4.29969 14.7002 8 14.7002C11.6297 14.7002 14.5829 11.8136 14.6943 8.21094C15.1734 7.90377 15.5956 7.51688 15.9443 7.06934C15.9797 7.37473 16 7.68512 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0ZM7.0166 3.6084C7.00658 3.73765 7 3.86817 7 4C7 4.31845 7.03098 4.62973 7.08789 4.93164C5.76489 5.32438 4.7998 6.54958 4.7998 8C4.7998 9.76731 6.23269 11.2002 8 11.2002C9.45065 11.2002 10.6749 10.2345 11.0674 8.91113C11.3696 8.96818 11.6812 9 12 9C12.1315 9 12.2617 8.99239 12.3906 8.98242C11.9423 10.995 10.1477 12.5 8 12.5C5.51472 12.5 3.5 10.4853 3.5 8C3.5 5.85255 5.00435 4.05702 7.0166 3.6084Z', fill: 'currentColor' }),
    createElement('path', { d: 'M7.5 8.62109L9.12109 7', fill: 'currentColor' }),
    createElement('path', { d: 'M9.08245 3.35798L11.8651 0.575334C11.895 0.545384 11.9463 0.56391 11.9502 0.606086L12.2362 3.69859C12.2384 3.72259 12.2574 3.74159 12.2814 3.74378L15.3697 4.02583C15.4119 4.02968 15.4305 4.08101 15.4005 4.11098L12.618 6.89351C12.6086 6.90289 12.5959 6.90816 12.5826 6.90816L9.11781 6.90815C9.09019 6.90816 9.06781 6.88577 9.06781 6.85816L9.06781 3.39333C9.06781 3.38007 9.07308 3.36735 9.08245 3.35798Z', fill: 'currentColor' }))
}

/** IconWarningOutline16 */
export function IconWarningOutline16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M6.3002 3.32843L7.69986 3.32843L7.69986 7.79657H6.3002L6.3002 3.32843Z', fill: 'currentColor' }),
    createElement('path', { d: 'M6.3002 9.01935H7.69986V10.6711H6.3002V9.01935Z', fill: 'currentColor' }),
    createElement('path', { d: 'M12.6328 6.99976C12.6328 3.88874 10.111 1.36694 7 1.36694C3.88899 1.36695 1.3672 3.88875 1.36719 6.99976C1.36719 10.1108 3.88899 12.6326 7 12.6326C10.111 12.6326 12.6328 10.1108 12.6328 6.99976ZM13.8582 6.99976C13.8582 10.7873 10.7876 13.8579 7 13.8579C3.21244 13.8579 0.141846 10.7873 0.141846 6.99976C0.141857 3.2122 3.21245 0.141612 7 0.141602C10.7876 0.141602 13.8581 3.21219 13.8582 6.99976Z', fill: 'currentColor' }))
}


/**
 * Plugin-original companions for learning-domain glyphs the host set does not
 * carry (lock/star/book/crown/bolt/power/pin/flame) — authored here in the
 * same 16px currentColor filled language as the ic_ds set, but they are NOT
 * ic_ds glyphs and must be re-drawn (not re-synced) if the style drifts.
 */
/** IconLockFill16 */
export function IconLockFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { 'fill-rule': 'evenodd', 'clip-rule': 'evenodd', d: 'M5 6.5V5a3 3 0 0 1 6 0v1.5h.6c.77 0 1.4.63 1.4 1.4v5.7c0 .77-.63 1.4-1.4 1.4H4.4A1.4 1.4 0 0 1 3 13.6V7.9c0-.77.63-1.4 1.4-1.4H5Zm1.444 0h3.112V5a1.556 1.556 0 0 0-3.112 0v1.5Z', fill: 'currentColor' }))
}

/** IconStarFill16 */
export function IconStarFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M8 1.6l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.42l-3.72 1.96.71-4.15-3.01-2.93 4.16-.6L8 1.6Z', fill: 'currentColor' }))
}

/** IconBookFill16 */
export function IconBookFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { 'fill-rule': 'evenodd', 'clip-rule': 'evenodd', d: 'M8 3.1C6.6 2.15 4.65 1.75 2.5 1.75c-.5 0-1 .03-1.5.1v10.7c.5-.07 1-.1 1.5-.1 2.15 0 4.1.4 5.5 1.35 1.4-.95 3.35-1.35 5.5-1.35.5 0 1 .03 1.5.1V1.85c-.5-.07-1-.1-1.5-.1-2.15 0-4.1.4-5.5 1.35ZM7.2 4.9v7.3C5.9 11.55 4.3 11.3 2.6 11.3V3.45c1.7 0 3.3.25 4.6 1.45Zm1.6 0c1.3-1.2 2.9-1.45 4.6-1.45v7.85c-1.7 0-3.3.25-4.6.9V4.9Z', fill: 'currentColor' }))
}

/** IconCrownFill16 */
export function IconCrownFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M1.7 11.2 1 4.9l3.6 2.2L8 2.6l3.4 4.5L15 4.9l-.7 6.3H1.7Zm.5 1.4h11.6v1.5H2.1v-1.5Z', fill: 'currentColor' }))
}

/** IconBoltFill16 */
export function IconBoltFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M9.6 1 3.4 9.3h3.4L6.3 15l6.3-8.5H9.2L9.6 1Z', fill: 'currentColor' }))
}

/** IconPowerFill16 */
export function IconPowerFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M7.2 1h1.6v5.6H7.2V1Z', fill: 'currentColor' }),
    createElement('path', { 'fill-rule': 'evenodd', 'clip-rule': 'evenodd', d: 'M4.55 3.15A6 6 0 1 0 11.45 3.15L12.5 4.2a7.5 7.5 0 1 1-9 0l1.05-1.05Z', fill: 'currentColor' }))
}

/** IconPinFill16 */
export function IconPinFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { 'fill-rule': 'evenodd', 'clip-rule': 'evenodd', d: 'M8 1.4a4.8 4.8 0 0 1 4.8 4.8c0 3.4-4.8 8.4-4.8 8.4S3.2 9.6 3.2 6.2A4.8 4.8 0 0 1 8 1.4Zm0 2.7a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z', fill: 'currentColor' }))
}

/** IconFlameFill16 */
export function IconFlameFill16({ size = 16, className }: IconProps) {
  return createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
  },
    createElement('path', { d: 'M8.9 1.2c.4 2.5-.9 3.9-2.1 5.2C5.6 7.7 4.4 9 4.4 10.9a3.9 3.9 0 0 0 7.8 0c0-1.6-.7-2.9-1.5-4-.3.8-.8 1.4-1.6 1.7.5-2.4-.2-5.4-1.2-7.4Z', fill: 'currentColor' }))
}

