import { describe, expect, it } from "vitest";
import { classifyManualSwingOutcome, classifyProcessSwingResult } from "./dealerSwingOutcome";

describe("dealer swing outcome classification", () => {
  it.each([undefined,null,'','   ',{code:'unexpected'}])('gives an actionable error when the receipt has no usable message (%s)',message=>{
    expect(classifyManualSwingOutcome({outcome:'error',message,detail:'SWING831_INJECTED_ACQUISITION_FAILURE'})).toEqual({kind:'error',message:'Chưa thực hiện được Swing. Hãy tải lại trạng thái bàn để kiểm tra.'});
  });
  it.each([
    ['DEALER_REST_REQUIRED','Dealer chưa đủ thời gian nghỉ. Chờ đủ lịch nghỉ rồi tải lại trạng thái bàn.'],
    ['DEALER_ACQUISITION_ATTENDANCE_STALE','Ca check-in của dealer không còn thuộc ngày vận hành hiện tại. Kiểm tra ca và tải lại trạng thái bàn.'],
  ])('explains the existing %s business reason without changing the error outcome',(detail,message)=>{
    expect(classifyManualSwingOutcome({outcome:'error',detail})).toEqual({kind:'error',message});
  });
  it('keeps an existing server message and unknown-outcome recovery semantics',()=>{
    expect(classifyManualSwingOutcome({outcome:'error',message:'Bàn vừa đóng.'})).toEqual({kind:'error',message:'Lỗi: Bàn vừa đóng.'});
    expect(classifyManualSwingOutcome({detail:'DEALER_REST_REQUIRED'}).kind).toBe('unknown');
  });
  it('accepts the current Edge completion without inventing a swing count from mixed metrics', () => {
    expect(classifyProcessSwingResult({ok:true,status:'completed',error_code:null,metrics:{club:{total:3,success:3,failed:0,no_dealer:0,tg_failed:0,skipped:0}},dry_run:false})).toEqual({
      kind:'success',message:'Đợt xử lý Swing đã hoàn tất. Đang cập nhật trạng thái bàn.',
    });
  });
  it.each([undefined,null,-1,1.5,NaN,Infinity,'2'])('does not fabricate a count for malformed legacy processed_count %s', processed_count => {
    expect(classifyProcessSwingResult({status:'completed',processed_count}).kind).toBe('unknown');
  });
  it('does not present an explicitly failed completion as success', () => {
    expect(classifyProcessSwingResult({ok:false,status:'completed',processed_count:2}).kind).toBe('unknown');
  });
  it('labels a dry-run as a simulation rather than a committed Swing', () => {
    expect(classifyProcessSwingResult({ok:true,status:'completed',dry_run:true,metrics:{}})).toEqual({kind:'info',message:'Đã hoàn tất mô phỏng Swing; đây không phải xác nhận đổi dealer.'});
  });
  it("never treats a missing or unknown manual outcome as success", () => {
    expect(classifyManualSwingOutcome(null).kind).toBe("unknown");
    expect(classifyManualSwingOutcome({ outcome: "future_value" }).kind).toBe("unknown");
  });

  it("only treats explicit swing outcomes as success", () => {
    expect(classifyManualSwingOutcome({ outcome: "swung" }).kind).toBe("success");
    expect(classifyManualSwingOutcome({ outcome: "race_lost" }).kind).toBe("warning");
  });

  it("does not show success for partial or malformed process-swing responses", () => {
    expect(classifyProcessSwingResult({ status: "partial" }).kind).toBe("error");
    expect(classifyProcessSwingResult({}).kind).toBe("unknown");
    expect(classifyProcessSwingResult({ status: "completed", processed_count: 2 })).toEqual({
      kind: "success",
      message: "Đã xử lý 2 swing",
    });
  });
});
