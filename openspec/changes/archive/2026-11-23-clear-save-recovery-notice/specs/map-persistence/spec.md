# map-persistence Specification Delta

## MODIFIED Requirements

### Requirement: Save failures are visible

A save that fails for any reason other than an ended session SHALL show the error notice "保存失败" and SHALL never be swallowed. Examples are a network failure, a server error or a refused payload. The edit SHALL stay in the editor and remain pending until the next edit or flush retries it. Network failures SHALL NOT switch the editor to a different store. When the current stable map later saves successfully and no newer edit is pending, the editor SHALL clear "保存失败". Successful saves SHALL NOT clear notices unrelated to saving, and an older successful write SHALL NOT clear a newer edit's failure notice.

#### Scenario: Write failure is visible

- **WHEN** a save request fails (the network is down or the server answers 500) after an edit
- **THEN** the editor shows the notice "保存失败", the edit remains in the editor, and the next edit after the network returns saves both changes

#### Scenario: Only a current successful save clears its failure notice

- **WHEN** the current stable map saves successfully after "保存失败" and no newer edit is pending
- **THEN** the failure notice disappears without a manual close action
- **AND** a notice unrelated to saving remains unchanged after the same successful save
