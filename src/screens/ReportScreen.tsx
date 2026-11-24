import { ScreenHeader } from '../components/ui'
import { t } from '../i18n'
import ReportView from './ReportView'

/** 이동 리포트 탭 */
export default function ReportScreen() {
  return (
    <div className="safe-top absolute inset-0 flex flex-col bg-white">
      <ScreenHeader title={t('tab.report')} />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <ReportView />
      </div>
    </div>
  )
}
